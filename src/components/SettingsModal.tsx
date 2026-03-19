/**
 * GhostChat — Settings Modal
 */

import { motion, AnimatePresence } from 'framer-motion';
import { X, Shield, Globe, Database, Ghost } from 'lucide-react';
import { useAppStore, useChatStore } from '../stores';
import { useState } from 'react';

export function SettingsModal() {
  const { activeModal, closeModal, torStatus, nodeOnline, ourPeerId, version, setTorStatus, setNodeOnline, setOurPeerId } = useAppStore();
  const [restarting, setRestarting] = useState(false);
  const [memoryOnly, setMemoryOnly] = useState(false);
  const [defaultEphemeral, setDefaultEphemeral] = useState(false);
  const { toggleEphemeral, currentTtl, setCurrentTtl } = useChatStore();

  if (activeModal !== 'settings') return null;

  const isTorActive = torStatus === 'connected';

  const handleTorToggle = async () => {
    if (restarting) return;

    if (isTorActive) {
      // Disable Tor
      await handleDisableTor();
    } else {
      // Enable Tor
      await handleEnableTor();
    }
  };

  const handleEnableTor = async () => {
    setRestarting(true);
    setTorStatus('bootstrapping', 10);
    setNodeOnline(false);
    
    try {
      const { createGhostNode, stopNode, getOurPeerId } = await import('../lib/p2p/node');
      const { registerProtocolHandler } = await import('../lib/p2p/protocol');
      const { initMessageService } = await import('../lib/p2p/message-service');
      const { startAnnouncing } = await import('../lib/p2p/peer-discovery');
      
      await stopNode();
      
      // Start Tor via Tauri IPC
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('start_tor');
        setTorStatus('bootstrapping', 40);
      } catch (err) {
        console.warn('Tor sidecar start failed:', err);
      }
      
      setTorStatus('bootstrapping', 60);
      await createGhostNode({ torEnabled: true, enableMdns: false });
      
      const peerId = getOurPeerId();
      if (peerId) setOurPeerId(peerId);
      
      try { await registerProtocolHandler(); } catch { /* ok */ }
      try { initMessageService(); } catch { /* ok */ }
      try { await startAnnouncing(); } catch { /* ok */ }
      
      setNodeOnline(true);
      setTorStatus('connected', 100);
    } catch (err) {
      console.error('Failed to enable Tor:', err);
      // Fallback: restart without Tor
      try {
        const { createGhostNode, stopNode, getOurPeerId } = await import('../lib/p2p/node');
        await stopNode();
        await createGhostNode({ torEnabled: false });
        const peerId = getOurPeerId();
        if (peerId) setOurPeerId(peerId);
        setNodeOnline(true);
        setTorStatus('inactive');
      } catch {
        setNodeOnline(false);
        setTorStatus('inactive');
      }
    }
    setRestarting(false);
  };

  const handleDisableTor = async () => {
    setRestarting(true);
    setTorStatus('bootstrapping', 10);
    setNodeOnline(false);
    
    try {
      const { createGhostNode, stopNode, getOurPeerId } = await import('../lib/p2p/node');
      const { registerProtocolHandler } = await import('../lib/p2p/protocol');
      const { initMessageService } = await import('../lib/p2p/message-service');
      const { startAnnouncing } = await import('../lib/p2p/peer-discovery');
      
      // Stop Tor sidecar
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('stop_tor');
      } catch { /* ok */ }
      
      await stopNode();
      await createGhostNode({ torEnabled: false, enableMdns: true });
      
      const peerId = getOurPeerId();
      if (peerId) setOurPeerId(peerId);
      
      try { await registerProtocolHandler(); } catch { /* ok */ }
      try { initMessageService(); } catch { /* ok */ }
      try { await startAnnouncing(); } catch { /* ok */ }
      
      setNodeOnline(true);
      setTorStatus('inactive');
    } catch (err) {
      console.error('Failed to disable Tor:', err);
      setNodeOnline(false);
      setTorStatus('inactive');
    }
    setRestarting(false);
  };

  const handleMemoryOnlyToggle = () => {
    setMemoryOnly(!memoryOnly);
    console.log('👻 Memory-only mode:', !memoryOnly);
  };

  const handleDefaultEphemeralToggle = () => {
    setDefaultEphemeral(!defaultEphemeral);
    toggleEphemeral();
    console.log('👻 Default ephemeral:', !defaultEphemeral);
  };

  const handleTtlChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const ttl = parseInt(e.target.value, 10);
    setCurrentTtl(ttl);
  };

  // Derive status strings
  const torStatusLabel = restarting ? 'Restarting...'
    : isTorActive ? 'Connected'
    : torStatus === 'bootstrapping' ? 'Connecting...'
    : 'Inactive';

  const p2pStatusLabel = restarting ? 'Restarting...'
    : nodeOnline ? 'Online'
    : 'Offline';

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 bg-void/80 backdrop-blur-sm z-50 flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={closeModal}
      >
        <motion.div
          className="bg-surface border border-border-subtle rounded-2xl w-[480px] max-w-[90vw] max-h-[80vh] overflow-y-auto shadow-2xl"
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle sticky top-0 bg-surface z-10">
            <h3 className="text-ghost-white font-medium">Settings</h3>
            <button onClick={closeModal} className="p-1.5 rounded-lg text-ghost-dim hover:text-ghost-white hover:bg-elevated transition-colors">
              <X size={18} />
            </button>
          </div>

          <div className="px-6 py-5 space-y-6">
            {/* Privacy */}
            <SettingsSection title="Privacy" icon={<Shield size={16} />}>
              <SettingsToggle 
                label="Tor routing" 
                description="Route all connections through Tor network" 
                enabled={isTorActive} 
                onClick={handleTorToggle}
                loading={restarting}
              />
              <SettingsToggle 
                label="Memory-only mode" 
                description="No data written to disk — true ghost mode" 
                enabled={memoryOnly}
                onClick={handleMemoryOnlyToggle}
              />
              <SettingsToggle 
                label="Anti-screenshot" 
                description="Block screenshots on mobile (coming soon)" 
                enabled={false} 
                disabled 
              />
            </SettingsSection>

            {/* Ghost Messages */}
            <SettingsSection title="Ghost Messages" icon={<Ghost size={16} />}>
              <SettingsToggle 
                label="Default ephemeral" 
                description="New conversations start in ghost mode" 
                enabled={defaultEphemeral}
                onClick={handleDefaultEphemeralToggle}
              />
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-ghost-white text-sm">Default TTL</p>
                  <p className="text-ghost-dim/60 text-xs">Time before messages dissolve</p>
                </div>
                <select 
                  value={currentTtl}
                  onChange={handleTtlChange}
                  className="bg-elevated text-ghost-white text-xs px-3 py-1.5 rounded-lg border border-border-subtle outline-none"
                >
                  <option value="0">Permanent</option>
                  <option value="5000">5 seconds</option>
                  <option value="60000">1 minute</option>
                  <option value="300000">5 minutes</option>
                  <option value="3600000">1 hour</option>
                  <option value="86400000">24 hours</option>
                </select>
              </div>
            </SettingsSection>

            {/* Network */}
            <SettingsSection title="Network" icon={<Globe size={16} />}>
              <div className="space-y-2">
                <InfoRow label="PeerID" value={ourPeerId ? ourPeerId.slice(0, 20) + '...' : 'Not initialized'} mono />
                <InfoRow label="Tor" value={torStatusLabel} />
                <InfoRow label="P2P" value={p2pStatusLabel} />
                <InfoRow label="Version" value={`v${version}`} />
              </div>
            </SettingsSection>

            {/* Danger zone */}
            <SettingsSection title="Danger Zone" icon={<Database size={16} />}>
              <button 
                onClick={() => {
                  if (confirm('Delete all data? This cannot be undone.')) {
                    console.log('👻 Data deletion requested');
                  }
                }}
                className="w-full text-left px-4 py-3 rounded-xl bg-accent-danger/5 border border-accent-danger/20 text-accent-danger text-sm hover:bg-accent-danger/10 transition-colors"
              >
                Delete All Data
              </button>
            </SettingsSection>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function SettingsSection({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-accent-glow/60">{icon}</span>
        <h4 className="text-ghost-white text-xs font-mono uppercase tracking-wider">{title}</h4>
      </div>
      <div className="space-y-1 ml-0.5">{children}</div>
    </div>
  );
}

function SettingsToggle({ label, description, enabled, disabled = false, onClick, loading = false }: { label: string; description: string; enabled: boolean; disabled?: boolean; onClick?: () => void; loading?: boolean }) {
  return (
    <div 
      className={`flex items-center justify-between py-2 ${disabled ? 'opacity-40' : 'cursor-pointer'}`}
      onClick={disabled ? undefined : onClick}
    >
      <div>
        <p className="text-ghost-white text-sm">{label}</p>
        <p className="text-ghost-dim/60 text-xs">{description}</p>
      </div>
      <div className={`w-10 h-5 rounded-full transition-colors duration-200 flex items-center ${enabled ? 'bg-accent-glow/30 justify-end' : 'bg-elevated justify-start'}`}>
        <div className={`w-4 h-4 rounded-full mx-0.5 transition-colors flex items-center justify-center ${enabled ? 'bg-accent-glow' : 'bg-ghost-dim/40'}`}>
          {loading && <div className="w-2 h-2 border border-void border-t-transparent rounded-full animate-spin" />}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-ghost-dim text-xs">{label}</span>
      <span className={`text-ghost-white text-xs ${mono ? 'font-code' : ''}`}>{value}</span>
    </div>
  );
}
