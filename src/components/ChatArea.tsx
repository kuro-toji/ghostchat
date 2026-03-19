/**
 * GhostChat — Chat Area (Enhanced Phase 6)
 * 
 * Active conversation view or empty state.
 */

import { motion } from 'framer-motion';
import { Lock, Zap } from 'lucide-react';
import { GhostLogo } from './GhostLogo';
import { ChatHeader } from './ChatHeader';
import { MessageBubble } from './MessageBubble';
import { MessageInput } from './MessageInput';
import { useChatStore, useContactStore } from '../stores';
import { useRef, useEffect } from 'react';

export function ChatArea() {
  const { activePeerId, messages } = useChatStore();
  const contacts = useContactStore((s) => s.contacts);
  const activeContact = contacts.find((c) => c.peerId === activePeerId);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (!activePeerId || !activeContact) {
    return <EmptyState />;
  }

  return (
    <div className="flex-1 flex flex-col bg-void relative">
      <ChatHeader
        peerId={activeContact.peerId}
        displayName={activeContact.displayName}
        online={activeContact.online}
        isVerified={activeContact.isVerified}
      />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto ghost-scrollbar py-4 space-y-2">
        {/* Encryption badge */}
        <div className="flex justify-center mb-4">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface/50 border border-border-subtle text-ghost-dim/50 text-[10px] font-code"
          >
            <Lock size={10} />
            <span>End-to-end encrypted · Double Ratchet</span>
          </motion.div>
        </div>

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      <MessageInput />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-void relative">
      <motion.div
        className="flex flex-col items-center gap-8"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3, duration: 1 }}
      >
        <GhostLogo size="lg" />
        <motion.div
          className="flex flex-col gap-3 mt-4"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1, duration: 0.6 }}
        >
          <FeatureChip icon={<Lock size={14} />} label="End-to-End Encrypted" sub="Double Ratchet + AES-256-GCM" />
          <FeatureChip
            icon={<TorIcon />}
            label="Tor Routed" sub="Your IP never exposed"
          />
          <FeatureChip icon={<Zap size={14} />} label="Pure P2P" sub="No servers · You ARE the network" />
        </motion.div>
        <motion.p
          className="text-ghost-dim/40 text-[10px] font-code mt-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5 }}
        >
          v0.1.0 · Select a contact to start chatting
        </motion.p>
      </motion.div>
    </div>
  );
}

function FeatureChip({ icon, label, sub }: { icon: React.ReactNode; label: string; sub: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-surface/50 border border-border-subtle hover:border-accent-glow/20 transition-colors duration-300 cursor-default group">
      <div className="text-accent-glow/60 group-hover:text-accent-glow transition-colors">{icon}</div>
      <div>
        <p className="text-ghost-white/80 text-xs font-medium">{label}</p>
        <p className="text-ghost-dim/60 text-[10px] font-code">{sub}</p>
      </div>
    </div>
  );
}

function TorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="11" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
