/**
 * GhostChat — Settings Modal
 */

import { motion, AnimatePresence } from 'framer-motion';
import { X, Shield, Globe, Database, Ghost, Moon } from 'lucide-react';
import { useAppStore } from '../stores';

export function SettingsModal() {
  const { activeModal, closeModal, torStatus, ourPeerId, version } = useAppStore();

  if (activeModal !== 'settings') return null;

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
              <SettingsToggle label="Tor routing" description="Route all connections through Tor network" enabled={torStatus === 'connected'} />
              <SettingsToggle label="Memory-only mode" description="No data written to disk — true ghost mode" enabled={false} />
              <SettingsToggle label="Anti-screenshot" description="Block screenshots on mobile (coming soon)" enabled={false} disabled />
            </SettingsSection>

            {/* Ghost Messages */}
            <SettingsSection title="Ghost Messages" icon={<Ghost size={16} />}>
              <SettingsToggle label="Default ephemeral" description="New conversations start in ghost mode" enabled={false} />
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-ghost-white text-sm">Default TTL</p>
                  <p className="text-ghost-dim/60 text-xs">Time before messages dissolve</p>
                </div>
                <select className="bg-elevated text-ghost-white text-xs px-3 py-1.5 rounded-lg border border-border-subtle outline-none">
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
                <InfoRow label="PeerID" value={ourPeerId?.slice(0, 20) + '...' || 'Not initialized'} mono />
                <InfoRow label="Tor status" value={torStatus} />
                <InfoRow label="Version" value={`v${version}`} />
              </div>
            </SettingsSection>

            {/* Danger zone */}
            <SettingsSection title="Danger Zone" icon={<Database size={16} />}>
              <button className="w-full text-left px-4 py-3 rounded-xl bg-accent-danger/5 border border-accent-danger/20 text-accent-danger text-sm hover:bg-accent-danger/10 transition-colors">
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

function SettingsToggle({ label, description, enabled, disabled = false }: { label: string; description: string; enabled: boolean; disabled?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-2 ${disabled ? 'opacity-40' : ''}`}>
      <div>
        <p className="text-ghost-white text-sm">{label}</p>
        <p className="text-ghost-dim/60 text-xs">{description}</p>
      </div>
      <div className={`w-10 h-5 rounded-full transition-colors duration-200 cursor-pointer flex items-center ${enabled ? 'bg-accent-glow/30 justify-end' : 'bg-elevated justify-start'}`}>
        <div className={`w-4 h-4 rounded-full mx-0.5 transition-colors ${enabled ? 'bg-accent-glow' : 'bg-ghost-dim/40'}`} />
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
