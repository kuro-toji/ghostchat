/**
 * GhostChat — Contact List Item
 * 
 * Individual contact in the sidebar list.
 */

import { motion } from 'framer-motion';
import { Identicon } from './Identicon';
import { useChatStore } from '../stores';

interface ContactItemProps {
  peerId: string;
  displayName: string;
  lastMessage?: string;
  lastMessageTime?: number;
  unreadCount?: number;
  online?: boolean;
  isVerified?: boolean;
}

export function ContactItem({
  peerId,
  displayName,
  lastMessage,
  lastMessageTime,
  unreadCount = 0,
  online = false,
  isVerified = false,
}: ContactItemProps) {
  const { activePeerId, setActivePeer } = useChatStore();
  const isActive = activePeerId === peerId;

  return (
    <motion.button
      onClick={() => setActivePeer(peerId)}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all duration-200 rounded-xl mx-2 ${
        isActive
          ? 'bg-accent-glow/10 border border-accent-glow/20'
          : 'hover:bg-elevated border border-transparent'
      }`}
      whileHover={{ x: 2 }}
      whileTap={{ scale: 0.98 }}
    >
      {/* Avatar */}
      <div className="relative flex-shrink-0">
        <Identicon peerId={peerId} size={44} />
        {online && (
          <motion.div
            className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-accent-safe rounded-full border-2 border-surface"
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ repeat: Infinity, duration: 2 }}
          />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-ghost-white text-sm font-medium truncate">
            {displayName || peerId.slice(0, 12) + '...'}
          </span>
          {isVerified && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-accent-safe flex-shrink-0">
              <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
          )}
        </div>
        {lastMessage && (
          <p className="text-ghost-dim text-xs truncate mt-0.5">
            {lastMessage}
          </p>
        )}
      </div>

      {/* Right */}
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        {lastMessageTime && (
          <span className="text-ghost-dim/60 text-[10px]">
            {formatTime(lastMessageTime)}
          </span>
        )}
        {unreadCount > 0 && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="min-w-[20px] h-5 flex items-center justify-center rounded-full bg-accent-glow text-void text-[10px] font-bold px-1.5"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </motion.span>
        )}
      </div>
    </motion.button>
  );
}

function formatTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const mins = Math.floor(diff / 60000);
  
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
