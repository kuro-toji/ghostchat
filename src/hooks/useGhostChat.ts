/**
 * GhostChat — Main App Hook
 * 
 * Orchestrates initialization and connects stores to services.
 */

import { useEffect } from 'react';
import { useAppStore, useContactStore } from '../stores';

/**
 * Main GhostChat hook — call in App component.
 * Handles initialization and event listeners.
 */
export function useGhostChat() {
  const setTorStatus = useAppStore((s) => s.setTorStatus);
  const setNodeOnline = useAppStore((s) => s.setNodeOnline);
  const setPeerCount = useAppStore((s) => s.setPeerCount);
  const setOurPeerId = useAppStore((s) => s.setOurPeerId);
  const setDbReady = useAppStore((s) => s.setDbReady);
  const addContact = useContactStore((s) => s.addContact);

  // Handle custom events from UI components
  useEffect(() => {
    const handleSend = (e: CustomEvent) => {
      const { text, ephemeral, ttl } = e.detail;
      console.log('👻 Sending message:', { text: text.slice(0, 20), ephemeral, ttl });
      // In production: call sendTextMessage() from message-service
    };

    const handleAddContact = (e: CustomEvent) => {
      const { peerId, displayName } = e.detail;
      console.log('👻 Adding contact:', peerId.slice(0, 16));
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

    const handleVerify = (e: CustomEvent) => {
      const { peerId } = e.detail;
      console.log('👻 Marking verified:', peerId.slice(0, 16));
      useContactStore.getState().updateContact(peerId, { isVerified: true });
    };

    window.addEventListener('ghostchat:send', handleSend as EventListener);
    window.addEventListener('ghostchat:add-contact', handleAddContact as EventListener);
    window.addEventListener('ghostchat:verify', handleVerify as EventListener);

    return () => {
      window.removeEventListener('ghostchat:send', handleSend as EventListener);
      window.removeEventListener('ghostchat:add-contact', handleAddContact as EventListener);
      window.removeEventListener('ghostchat:verify', handleVerify as EventListener);
    };
  }, [addContact]);

  // Initialize app (placeholder — full init in production)
  useEffect(() => {
    console.log('👻 GhostChat initializing...');
    setDbReady(true);
    
    return () => {
      console.log('👻 GhostChat cleanup');
    };
  }, [setDbReady]);

  return {
    setTorStatus,
    setNodeOnline,
    setPeerCount,
    setOurPeerId,
  };
}
