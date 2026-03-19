/**
 * GhostChat — Message Bubble
 * 
 * Individual message in the chat with dissolve animation for ephemeral messages.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { Clock, Check, CheckCheck, Ghost } from 'lucide-react';
import { useChatStore } from '../stores';
import type { DecryptedMessage } from '../types';

interface MessageBubbleProps {
  message: DecryptedMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const dissolvingIds = useChatStore((s) => s.dissolvingIds);
  const isDissolving = dissolvingIds.has(message.id);
  const isOutgoing = !message.incoming;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={
        isDissolving
          ? {
              opacity: 0,
              scale: 0.8,
              filter: 'blur(12px)',
              y: -10,
            }
          : { opacity: 1, y: 0, scale: 1 }
      }
      transition={
        isDissolving
          ? { duration: 1, ease: 'easeInOut' }
          : { duration: 0.3, ease: 'easeOut' }
      }
      className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'} px-4`}
    >
      <div
        className={`max-w-[70%] rounded-2xl px-4 py-2.5 ${
          isOutgoing
            ? 'bg-accent-glow/15 border border-accent-glow/20 rounded-br-md'
            : 'bg-elevated border border-border-subtle rounded-bl-md'
        }`}
      >
        {/* Message content */}
        <p className="text-ghost-white text-sm leading-relaxed break-words">
          {message.content}
        </p>

        {/* Footer: time + status */}
        <div className={`flex items-center gap-1.5 mt-1 ${isOutgoing ? 'justify-end' : 'justify-start'}`}>
          {message.ephemeral && (
            <Ghost size={10} className="text-accent-glow/40" />
          )}
          {message.ephemeral && message.expiresAt && (
            <span className="text-[9px] font-code text-accent-glow/40">
              {formatRemaining(message.expiresAt - Date.now())}
            </span>
          )}
          <span className="text-[10px] text-ghost-dim/40 font-code">
            {formatMessageTime(message.timestamp)}
          </span>
          {isOutgoing && (
            <span className="text-ghost-dim/40">
              {message.read ? (
                <CheckCheck size={12} className="text-accent-glow/60" />
              ) : message.delivered ? (
                <CheckCheck size={12} />
              ) : (
                <Check size={12} />
              )}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function formatMessageTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return 'expiring';
  const secs = Math.ceil(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.ceil(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.ceil(mins / 60);
  return `${hours}h`;
}
