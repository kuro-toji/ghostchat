/**
 * GhostChat — Main App Hook
 * 
 * Orchestrates initialization and connects stores to services.
 */

import { useEffect } from 'react';
import { useAppStore, useContactStore } from '../stores';

export function useGhostChat() {
  const setTorStatus = useAppStore((s) => s.setTorStatus);
  const setNodeOnline = useAppStore((s) => s.setNodeOnline);
  const setPeerCount = useAppStore((s) => s.setPeerCount);
  const setOurPeerId = useAppStore((s) => s.setOurPeerId);
  const setDbReady = useAppStore((s) => s.setDbReady);
  const addContact = useContactStore((s) => s.addContact);

  useEffect(() => {
    const init = async () => {
      console.log('👻 GhostChat initializing...');
      
      setTorStatus('bootstrapping', 50);
      setDbReady(true);
      
      // Generate demo peer ID for now
      const demoPeerId = '12D3KooW' + Math.random().toString(36).substring(2, 15);
      setOurPeerId(demoPeerId);
      setNodeOnline(true);
      setTorStatus('connected', 100);
      console.log('👻 Demo mode active, PeerID:', demoPeerId);
    };
    
    init();
    
    return () => console.log('👻 Cleanup');
  }, []);

  useEffect(() => {
    const handleSend = (e: CustomEvent) => {
      console.log('👻 Send:', e.detail);
    };

    const handleAddContact = (e: CustomEvent) => {
      const { peerId, displayName } = e.detail;
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
    };

    window.addEventListener('ghostchat:send', handleSend as EventListener);
    window.addEventListener('ghostchat:add-contact', handleAddContact as EventListener);

    return () => {
      window.removeEventListener('ghostchat:send', handleSend as EventListener);
      window.removeEventListener('ghostchat:add-contact', handleAddContact as EventListener);
    };
  }, [addContact]);

  return { setTorStatus, setNodeOnline, setPeerCount, setOurPeerId };
}
