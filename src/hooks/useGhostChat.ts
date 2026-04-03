import { useEffect, useRef } from 'react';
import { useAppStore, useContactStore, useChatStore } from '../stores';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export function useGhostChat() {
  const setTorStatus = useAppStore((s) => s.setTorStatus);
  const setNodeOnline = useAppStore((s) => s.setNodeOnline);
  const setPeerCount = useAppStore((s) => s.setPeerCount);
  const setOurPeerId = useAppStore((s) => s.setOurPeerId);
  const setDbReady = useAppStore((s) => s.setDbReady);
  const addContact = useContactStore((s) => s.addContact);
  const setOnline = useContactStore((s) => s.setOnline);
  const addMessage = useChatStore((s) => s.addMessage);

  const cleanupRef = useRef<(() => void)[]>([]);
  const nodeStartedRef = useRef(false);

  useEffect(() => {
    if (nodeStartedRef.current) return;
    nodeStartedRef.current = true;

    const init = async () => {
      console.log('👻 GhostChat initializing (IPC Backend)...');

      try {
        setTorStatus('bootstrapping', 10);

        // ── 1. Init DB and Identity ──
        const { initDatabase } = await import('../lib/storage/database');
        const { bytesToHex, hexToBytes, randomBytes } = await import('@noble/hashes/utils');
        
        let masterKeyHex: string | null = null;
        try {
          masterKeyHex = await invoke<string | null>('get_master_key');
        } catch (err) {
          console.warn('Could not read from secure enclave:', err);
        }

        let masterKey: Uint8Array;
        
        if (!masterKeyHex) {
          masterKey = randomBytes(32);
          try {
            await invoke('save_master_key', { keyHex: bytesToHex(masterKey) });
          } catch (err) {
            console.error('Failed to save master key to secure storage:', err);
            // Fallback could be handled here if needed
          }
        } else {
          masterKey = hexToBytes(masterKeyHex);
        }
        
        await initDatabase(masterKey, 'ghostchat.db');
        setDbReady(true);

        const { loadOrCreateIdentity } = await import('../lib/storage/identity-store');
        const identity = await loadOrCreateIdentity();

        const { initMessageService, onIncomingMessage, setOurIdentity } = await import('../lib/p2p/message-service');
        const { registerProtocolHandler } = await import('../lib/p2p/protocol');

        setOurIdentity(identity);

        // Derive and set X25519 Responder Identity using classic RFC7748 clamped scalar derivation
        import('@noble/hashes/sha512').then(({ sha512 }) => {
          const hash = sha512(identity.privateKey.slice(0, 32));
          const scalar = hash.slice(0, 32);
          scalar[0] &= 248;
          scalar[31] &= 127;
          scalar[31] |= 64;
          import('../lib/p2p/message-service').then(({ setOurX25519Identity }) => {
            setOurX25519Identity(scalar);
          });
        });

        // Wait to make sure Tor starts if needed (we still init Tor for anonymous outbound traffic)
        // attemptTor is non-blocking in the background
        attemptTor(setTorStatus);

        // ── 2. Start Rust P2P Node (with same identity key) ──
        setTorStatus('bootstrapping', 30);
        console.log('👻 Invoking start_p2p_node on backend...');
        const ourPeerId = await invoke<string>('start_p2p_node', {
          identityKeyHex: bytesToHex(identity.privateKey),
          useTor: false
        });
        
        setOurPeerId(ourPeerId);
        setNodeOnline(true);
        console.log('👻 Backend node started. Our PeerID:', ourPeerId);

        // Step 1: Publish X3DH prekey bundle to DHT
        import('../lib/p2p/x3dh').then(({ publishPreKeyBundle }) => {
          publishPreKeyBundle(identity, ourPeerId).catch(err => {
            console.error('👻 Failed to publish X3DH PreKeys:', err);
          });
        });

        // ── 3. Register Protocol and Listeners ──
        await registerProtocolHandler();
        initMessageService();

        // Listen for Incoming Messages (handled internally by message service)
        const unsubIncoming = onIncomingMessage((message) => {
          console.log(`👻 Incoming message from ${message.senderPeerId.slice(0, 16)}...`);
          addMessage(message);
        });
        cleanupRef.current.push(unsubIncoming);

        // Listen for Peer Status Changes
        const unlistenStatus = await listen<{peer_id: string, online: boolean}>('ghostchat://peer-status', (event) => {
          const { peer_id, online } = event.payload;
          console.log(`👻 Peer status change: ${peer_id.slice(0, 16)}... → ${online ? 'connected' : 'disconnected'}`);
          
          setOnline(peer_id, online);
          
          if (online) {
            const contacts = useContactStore.getState().contacts;
            import('../lib/p2p/session-manager').then(({ hasActiveSession }) => {
              const contact = contacts.find(c => c.peerId === peer_id);
              if (contact && !hasActiveSession(peer_id)) {
                // Tie-breaker: Only the peer with the lexicographically smaller PeerID initiates
                if (ourPeerId && ourPeerId < peer_id) {
                  console.log(`👻 Handshake tie-breaker: Initiating (we are smaller)`);
                  dialContactInBackground(peer_id, contact.multiaddr ?? null);
                } else {
                  console.log(`👻 Handshake tie-breaker: Waiting for remote to initiate`);
                }
              }
            });
          }
          
          // Poll peer count via backend
          invoke<string[]>('get_connected_peers').then(peers => setPeerCount(peers.length));
        });
        cleanupRef.current.push(unlistenStatus);

        console.log('👻 P2P fully initialized (IPC Backend)');
      } catch (err) {
        console.error('👻 Initialization failed:', err);
        setNodeOnline(false);
      }
    };

    init();

    return () => {
      console.log('👻 Cleanup');
      for (const cleanup of cleanupRef.current) {
        try { cleanup(); } catch { /* ignore */ }
      }
      cleanupRef.current = [];
    };
  }, []);

  // ── 2. Event Handlers ──────────
  useEffect(() => {
    const handleSend = async (e: CustomEvent) => {
      const { text, ephemeral, ttl } = e.detail;
      const currentPeerId = useChatStore.getState().activePeerId;
      
      if (!currentPeerId || !text) return;

      const displayMsg = {
        id: crypto.randomUUID(),
        senderPeerId: useAppStore.getState().ourPeerId ?? 'unknown',
        content: text,
        timestamp: Date.now(),
        incoming: false,
        delivered: false,
        read: false,
        ephemeral: ephemeral ?? false,
        ttl: ttl ?? 0,
        expiresAt: ttl ? Date.now() + ttl : null,
      };

      try {
        const { hasActiveSession } = await import('../lib/p2p/session-manager');
        const nodeOnline = useAppStore.getState().nodeOnline;
        
        if (nodeOnline) {
          if (hasActiveSession(currentPeerId)) {
            const { sendTextMessage } = await import('../lib/p2p/message-service');
            const msg = await sendTextMessage(currentPeerId, text, { ephemeral, ttl });
            addMessage(msg);
            console.log('👻 Message sent to', currentPeerId.slice(0, 16) + '...');
            return;
          } else {
            const { sendX3DHMessage } = await import('../lib/p2p/message-service');
            const msg = await sendX3DHMessage(currentPeerId, text, { ephemeral, ttl });
            if (msg) addMessage(msg);
            console.log('👻 X3DH Initial Message sent to', currentPeerId.slice(0, 16) + '...');
            return;
          }
        }
      } catch (err) {
        console.warn('👻 P2P send failed:', err);
      }

      displayMsg.delivered = false;
      addMessage(displayMsg);
      console.log('👻 Message queued locally for', currentPeerId.slice(0, 16) + '...');
    };

    const handleAddContact = (e: CustomEvent) => {
      const { peerId, displayName, multiaddr } = e.detail;
      if (!peerId) return;

      addContact({
        peerId,
        displayName: displayName || peerId.slice(0, 12),
        publicKey: '',
        addedAt: Date.now(),
        lastSeen: null,
        isVerified: false,
        defaultTtl: 0,
        online: false,
        multiaddr: multiaddr || null,
      });

      dialContactInBackground(peerId, multiaddr || null);
    };

    window.addEventListener('ghostchat:send', handleSend as unknown as EventListener);
    window.addEventListener('ghostchat:add-contact', handleAddContact as unknown as EventListener);

    return () => {
      window.removeEventListener('ghostchat:send', handleSend as unknown as EventListener);
      window.removeEventListener('ghostchat:add-contact', handleAddContact as unknown as EventListener);
    };
  }, [addContact, addMessage]);

  return { setTorStatus, setNodeOnline, setPeerCount, setOurPeerId };
}

async function attemptTor(
  setTorStatus: (status: 'inactive' | 'bootstrapping' | 'connected' | 'error', progress?: number) => void
): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    setTorStatus('bootstrapping', 20);
    await invoke('start_tor');
    
    const maxWait = 90000;
    const pollInterval = 2000;
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
      try {
        const status = await invoke<{
          active: boolean;
          state: string;
          bootstrap_progress: number;
          onion_address: string | null;
          socks_port: number;
        }>('get_tor_status');
        
        setTorStatus('bootstrapping', status.bootstrap_progress);
        if (status.state === 'connected') {
          setTorStatus('connected', 100);
          console.log('👻 Tor connected! Onion:', status.onion_address);
          return;
        }
        if (status.state === 'error') {
          setTorStatus('inactive');
          return;
        }
      } catch {}
      await new Promise(r => setTimeout(r, pollInterval));
    }
    setTorStatus('inactive');
  } catch {
    setTorStatus('inactive');
  }
}

async function dialContactInBackground(peerId: string, multiaddr: string | null = null): Promise<void> {
  try {
    console.log(`👻 Querying Rendezvous to discover routes for ${peerId.slice(0, 16)}...`);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('discover_peers', { peerId });
      // Wait for the Discovered events to populate the Rust Swarm's routing tables
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (err) {
      console.warn(`👻 Rendezvous discovery error (falling back to Kademlia/mDNS):`, err);
    }

    console.log(`👻 Triggering finalized backend dial for ${peerId.slice(0, 16)}...`);
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('dial_peer', { peerId, multiaddr });

    const { createSession } = await import('../lib/p2p/session-manager');
    
    createSession(peerId);
  } catch (err) {
    console.warn(`👻 Could not handshake with contact ${peerId.slice(0, 16)}...`, err);
  }
}
