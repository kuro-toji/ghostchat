/**
 * GhostChat — Sidebar (Enhanced Phase 6)
 */

import { motion } from 'framer-motion';
import { Search, UserPlus, Settings } from 'lucide-react';
import { GhostLogo } from './GhostLogo';
import { ContactItem } from './ContactItem';
import { Identicon } from './Identicon';
import { useAppStore, useContactStore } from '../stores';

export function Sidebar() {
  const { torStatus, ourPeerId, openModal, peerCount } = useAppStore();
  const { searchQuery, setSearchQuery, filteredContacts } = useContactStore();
  const contacts = filteredContacts();

  return (
    <motion.aside
      className="w-[320px] min-w-[320px] h-full flex flex-col bg-surface border-r border-border-subtle"
      initial={{ x: -320 }}
      animate={{ x: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
        <GhostLogo size="sm" />
        <div className="flex items-center gap-1.5">
          <TorIndicator status={torStatus} />
          <button
            onClick={() => openModal('add-contact')}
            className="p-2 rounded-lg text-ghost-dim hover:text-ghost-white hover:bg-elevated transition-colors duration-200"
            title="Add Contact"
          >
            <UserPlus size={18} />
          </button>
          <button
            onClick={() => openModal('settings')}
            className="p-2 rounded-lg text-ghost-dim hover:text-ghost-white hover:bg-elevated transition-colors duration-200"
            title="Settings"
          >
            <Settings size={18} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-4 py-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ghost-dim" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search contacts..."
            className="w-full bg-elevated text-ghost-white text-sm pl-10 pr-4 py-2.5 rounded-xl border border-border-subtle focus:border-accent-glow/50 focus:ring-1 focus:ring-accent-glow/20 outline-none transition-all duration-200 placeholder:text-ghost-dim/60"
          />
        </div>
      </div>

      {/* Contact list */}
      <div className="flex-1 overflow-y-auto ghost-scrollbar">
        {contacts.length > 0 ? (
          <div className="space-y-0.5 py-1">
            {contacts.map((contact) => (
              <ContactItem
                key={contact.peerId}
                peerId={contact.peerId}
                displayName={contact.displayName}
                online={contact.online}
                isVerified={contact.isVerified}
              />
            ))}
          </div>
        ) : (
          <EmptyContacts onAdd={() => openModal('add-contact')} />
        )}
      </div>

      {/* Identity */}
      <div className="px-4 py-3 border-t border-border-subtle">
        <div className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-elevated transition-colors cursor-pointer">
          {ourPeerId ? (
            <Identicon peerId={ourPeerId} size={40} />
          ) : (
            <div className="w-10 h-10 rounded-full bg-accent-glow/10 border border-accent-glow/20 flex items-center justify-center">
              <span className="text-accent-glow font-mono text-sm">G</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-ghost-white text-sm font-medium truncate">Your Identity</p>
            <p className="text-ghost-dim text-[10px] font-code truncate">
              {ourPeerId ? ourPeerId.slice(0, 20) + '...' : 'Not initialized'}
            </p>
          </div>
          <div className="text-ghost-dim/40 text-[10px] font-code">{peerCount}p</div>
        </div>
      </div>
    </motion.aside>
  );
}

function TorIndicator({ status }: { status: string }) {
  const colors: Record<string, string> = {
    inactive: 'text-ghost-dim',
    bootstrapping: 'text-accent-glow animate-pulse',
    connected: 'text-accent-safe',
    error: 'text-accent-danger',
  };

  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-elevated border border-border-subtle ${colors[status] ?? colors.inactive}`} title={`Tor: ${status}`}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="12" cy="12" r="11" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span className="text-[10px] font-mono">TOR</span>
    </div>
  );
}

function EmptyContacts({ onAdd }: { onAdd: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex-1 flex flex-col items-center justify-center px-6 text-center py-12"
    >
      <div className="w-16 h-16 rounded-2xl bg-elevated border border-border-subtle flex items-center justify-center mb-3">
        <UserPlus size={28} className="text-ghost-dim" />
      </div>
      <p className="text-ghost-dim text-sm font-mono">No contacts yet</p>
      <p className="text-ghost-dim/60 text-xs max-w-[200px] mt-1">
        Share your PeerID or paste a contact's PeerID to start chatting
      </p>
      <button
        onClick={onAdd}
        className="mt-3 px-4 py-2 bg-accent-glow/10 text-accent-glow text-xs font-mono rounded-lg border border-accent-glow/20 hover:bg-accent-glow/20 transition-colors"
      >
        + Add First Contact
      </button>
    </motion.div>
  );
}
