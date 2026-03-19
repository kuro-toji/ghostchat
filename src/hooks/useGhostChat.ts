/**
 * GhostChat — Main App Hook (LIVE MODE)
 * 
 * Orchestrates P2P initialization, Tor connection,
 * message service, and wires everything to Zustand stores.
 * 
 * Startup sequence:
 *   1. Try create libp2p node (WebRTC + WebSocket + Circuit Relay)
 *   2. If successful: register protocol, message service, DHT announcing
 *   3. If failed: graceful degradation — UI stays functional
 *   4. Attempt Tor connection (non-blocking)
 *   5. Monitor peer connections and update stores
 */

import { useEffect, useRef } from 'react';
import { useAppStore, useContactStore, useChatStore } from '../stores';

export function useGhostChat() {
  const setTorStatus = useAppStore((s) => s.setTorStatus);
  const setNodeOnline = useAppStore((s) => s.setNodeOnline);
  const setPeerCount = useAppStore((s) => s.setPeerCount);
  const setOurPeerId = useAppStore((s) => s.setOurPeerId);
  const setDbReady = useAppStore((s) => s.setDbReady);
  const addContact = useContactStore((s) => s.addContact);
  const setOnline = useContactStore((s) => s.setOnline);
  const addMessage = useChatStore((s) => s.addMessage);

  // Track cleanup functions
  const cleanupRef = useRef<(() => void)[]>([]);
  const nodeStartedRef = useRef(false);

  // ── 1. Node Initialization ─────────────────────────────────
  useEffect(() => {
    if (nodeStartedRef.current) return;
    nodeStartedRef.current = true;

    const init = async () => {
      console.log('👻 GhostChat initializing...');
      setDbReady(true);

      // ── Try starting the P2P node ──
      let p2pSuccess = false;

      try {
        setTorStatus('bootstrapping', 10);

        const {
          createGhostNode,
          getOurPeerId,
          onPhaseChange,
        } = await import('../lib/p2p/node');

        const {
          startAnnouncing,
          getConnectedPeerCount,
          onPeerDiscovered,
        } = await import('../lib/p2p/peer-discovery');

        const {
          onConnectionChange,
        } = await import('../lib/p2p/connections');

        const {
          registerProtocolHandler,
        } = await import('../lib/p2p/protocol');

        const {
          initMessageService,
          onIncomingMessage,
        } = await import('../lib/p2p/message-service');

        // Create the node
        setTorStatus('bootstrapping', 30);
        await createGhostNode({
          torEnabled: false,
          enableMdns: true,
          allowClearnetBootstrap: true,
        });

        // Set our real PeerID
        const ourPeerId = getOurPeerId();
        if (ourPeerId) {
          setOurPeerId(ourPeerId);
          console.log('👻 Our PeerID:', ourPeerId);
        }

        setNodeOnline(true);
        p2pSuccess = true;

        // Register protocol handler
        try {
          await registerProtocolHandler();
          console.log('👻 Protocol handler registered');
        } catch (err) {
          console.warn('👻 Protocol handler registration failed:', err);
        }

        // Initialize message service
        try {
          initMessageService();
          console.log('👻 Message service initialized');
        } catch (err) {
          console.warn('👻 Message service init failed:', err);
        }

        // Start DHT announcing
        try {
          await startAnnouncing();
          console.log('👻 DHT announcing started');
        } catch (err) {
          console.warn('👻 DHT announce failed (expected on first run):', err);
        }

        // Monitor node phase changes
        const unsubPhase = onPhaseChange((phase) => {
          console.log('👻 Node phase:', phase);
          if (phase === 'ready') {
            setNodeOnline(true);
          } else if (phase === 'cold_start') {
            setNodeOnline(false);
          }
        });
        cleanupRef.current.push(unsubPhase);

        // Monitor peer discovery
        const unsubDiscovery = onPeerDiscovered((peerId, addrs) => {
          console.log(`👻 Peer discovered: ${peerId.slice(0, 20)}... (${addrs.length} addrs)`);
          setPeerCount(getConnectedPeerCount());
        });
        cleanupRef.current.push(unsubDiscovery);

        // Monitor connection changes
        const unsubConnection = onConnectionChange((peerId, status) => {
          console.log(`👻 Connection change: ${peerId.slice(0, 20)}... → ${status}`);
          const isOnline = status === 'connected' || status === 'relayed';
          setOnline(peerId, isOnline);
          setPeerCount(getConnectedPeerCount());
        });
        cleanupRef.current.push(unsubConnection);

        // Monitor incoming messages
        const unsubIncoming = onIncomingMessage((message) => {
          console.log(`👻 Incoming message from ${message.senderPeerId.slice(0, 16)}...`);
          addMessage(message);
        });
        cleanupRef.current.push(unsubIncoming);

        // Peer count polling (fallback)
        const peerCountInterval = setInterval(() => {
          setPeerCount(getConnectedPeerCount());
        }, 10000);
        cleanupRef.current.push(() => clearInterval(peerCountInterval));

        console.log('👻 P2P node fully initialized');

      } catch (err) {
        console.error('👻 P2P initialization failed:', err);
        // Don't set error status — just mark P2P as offline but keep app working
        setNodeOnline(false);
        p2pSuccess = false;
      }

      // ── Generate PeerID if P2P failed ──
      if (!p2pSuccess) {
        // Generate a local identity so the UI works
        const fallbackId = '12D3KooW' + Array.from(crypto.getRandomValues(new Uint8Array(16)))
          .map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 30);
        setOurPeerId(fallbackId);
        setNodeOnline(false);
        console.warn('👻 Running in LOCAL MODE — P2P not available, UI still functional');
      }

      // ── Attempt Tor connection (non-blocking) ──
      attemptTor(setTorStatus);
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

  // ── 2. Event Handlers (send message, add contact) ──────────
  useEffect(() => {
    const handleSend = async (e: CustomEvent) => {
      const { text, ephemeral, ttl } = e.detail;
      const currentPeerId = useChatStore.getState().activePeerId;
      
      if (!currentPeerId || !text) return;

      // Build display message first (always show it locally)
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

      // Try to send via P2P
      try {
        const { hasActiveSession } = await import('../lib/p2p/session-manager');
        const { isNodeRunning } = await import('../lib/p2p/node');
        
        if (isNodeRunning() && hasActiveSession(currentPeerId)) {
          const { sendTextMessage } = await import('../lib/p2p/message-service');
          const msg = await sendTextMessage(currentPeerId, text, { ephemeral, ttl });
          addMessage(msg);
          console.log('👻 Message sent to', currentPeerId.slice(0, 16) + '...');
          return;
        }
      } catch (err) {
        console.warn('👻 P2P send failed:', err);
      }

      // Show locally (peer offline or no active session)
      displayMsg.delivered = false;
      addMessage(displayMsg);
      console.log('👻 Message queued locally for', currentPeerId.slice(0, 16) + '...');
    };

    const handleAddContact = (e: CustomEvent) => {
      const { peerId, displayName } = e.detail;
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
      });

      // Try to dial the peer in the background
      dialContactInBackground(peerId);
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

// ── Helpers ────────────────────────────────────────────────────

/**
 * Attempt Tor connection via Tauri IPC.
 * Non-blocking — if Tor isn't available, we stay on clearnet.
 */
async function attemptTor(
  setTorStatus: (status: 'inactive' | 'bootstrapping' | 'connected' | 'error', progress?: number) => void
): Promise<void> {
  try {
    // Check if we're running inside Tauri
    const { invoke } = await import('@tauri-apps/api/core');
    
    setTorStatus('bootstrapping', 20);
    
    // Start Tor sidecar
    await invoke('start_tor');
    console.log('👻 Tor start command sent');
    
    // Poll for bootstrap completion
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
          console.warn('👻 Tor error, running clearnet');
          setTorStatus('inactive');
          return;
        }
      } catch {
        // Status check failed
      }
      
      await new Promise(r => setTimeout(r, pollInterval));
    }
    
    console.warn('👻 Tor bootstrap timed out, running clearnet');
    setTorStatus('inactive');
    
  } catch {
    // Not running in Tauri or Tor not available — this is normal
    console.log('👻 Tor not available — running clearnet mode');
    setTorStatus('inactive');
  }
}

/**
 * Attempt to dial a newly-added contact in the background.
 */
async function dialContactInBackground(peerId: string): Promise<void> {
  try {
    const { isNodeRunning } = await import('../lib/p2p/node');
    if (!isNodeRunning()) return;
    
    const { dialWithRetry } = await import('../lib/p2p/connections');
    console.log(`👻 Dialing contact ${peerId.slice(0, 16)}...`);
    
    await dialWithRetry(peerId);
    console.log(`👻 Connected to contact ${peerId.slice(0, 16)}...`);
  } catch (err) {
    console.warn(`👻 Could not reach contact ${peerId.slice(0, 16)}... (they may be offline):`, err);
  }
}
