/**
 * GhostChat — Chat Header
 * 
 * Top bar in chat view: contact info, encryption status, call/options.
 */

import { motion } from 'framer-motion';
import { Shield, ShieldCheck, Phone, MoreVertical } from 'lucide-react';
import { Identicon } from './Identicon';
import { useAppStore } from '../stores';

interface ChatHeaderProps {
  peerId: string;
  displayName: string;
  online: boolean;
  isVerified: boolean;
  latencyMs?: number;
}

export function ChatHeader({ peerId, displayName, online, isVerified, latencyMs }: ChatHeaderProps) {
  const openModal = useAppStore((s) => s.openModal);
  
  return (
    <motion.div
      className="flex items-center justify-between px-5 py-3 border-b border-border-subtle bg-surface/80 backdrop-blur-sm"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <div className="relative">
          <Identicon peerId={peerId} size={38} />
          {online && (
            <motion.div
              className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-accent-safe rounded-full border-2 border-surface"
              animate={{ scale: [1, 1.15, 1] }}
              transition={{ repeat: Infinity, duration: 2 }}
            />
          )}
        </div>
        <div>
          <h2 className="text-ghost-white text-sm font-medium">
            {displayName || peerId.slice(0, 16) + '...'}
          </h2>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-code ${online ? 'text-accent-safe' : 'text-ghost-dim/50'}`}>
              {online ? 'online' : 'offline'}
            </span>
            {latencyMs !== undefined && online && (
              <span className="text-[10px] font-code text-ghost-dim/40">{latencyMs}ms</span>
            )}
          </div>
        </div>
      </div>
      
      <div className="flex items-center gap-1">
        {/* Encryption status */}
        <button
          onClick={() => openModal('key-verification', { peerId })}
          className={`p-2 rounded-lg transition-colors duration-200 ${
            isVerified
              ? 'text-accent-safe hover:bg-accent-safe/10'
              : 'text-ghost-dim hover:bg-elevated'
          }`}
          title={isVerified ? 'Keys verified ✓' : 'Verify encryption keys'}
        >
          {isVerified ? <ShieldCheck size={18} /> : <Shield size={18} />}
        </button>
        
        <button
          className="p-2 rounded-lg text-ghost-dim hover:text-ghost-white hover:bg-elevated transition-colors duration-200"
          title="Voice call (coming soon)"
          disabled
        >
          <Phone size={18} />
        </button>
        
        <button className="p-2 rounded-lg text-ghost-dim hover:text-ghost-white hover:bg-elevated transition-colors duration-200">
          <MoreVertical size={18} />
        </button>
      </div>
    </motion.div>
  );
}
