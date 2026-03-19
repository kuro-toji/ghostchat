/**
 * GhostChat — Message Input
 * 
 * Bottom input bar with ghost toggle, TTL selector, send button.
 */

import { motion } from 'framer-motion';
import { Send, Ghost, Clock, Smile } from 'lucide-react';
import { useChatStore } from '../stores';
import { TTL_PRESETS } from '../types';
import { useState, useRef, type KeyboardEvent } from 'react';

export function MessageInput() {
  const { inputText, setInputText, ephemeralMode, toggleEphemeral, currentTtl, setCurrentTtl } = useChatStore();
  const [showTtlMenu, setShowTtlMenu] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (!inputText.trim()) return;
    // Dispatch send via event — handled by App
    window.dispatchEvent(new CustomEvent('ghostchat:send', {
      detail: { text: inputText.trim(), ephemeral: ephemeralMode, ttl: currentTtl },
    }));
    setInputText('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const ttlOptions = [
    { label: 'Off', value: TTL_PRESETS.PERMANENT },
    { label: '5s', value: TTL_PRESETS.FIVE_SECONDS },
    { label: '1m', value: TTL_PRESETS.ONE_MINUTE },
    { label: '5m', value: TTL_PRESETS.FIVE_MINUTES },
    { label: '1h', value: TTL_PRESETS.ONE_HOUR },
    { label: '24h', value: TTL_PRESETS.TWENTY_FOUR_HOURS },
  ];

  return (
    <div className="px-4 py-3 border-t border-border-subtle bg-surface/80 backdrop-blur-sm">
      {/* TTL dropdown */}
      {showTtlMenu && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-2 flex gap-1.5 flex-wrap"
        >
          {ttlOptions.map(({ label, value }) => (
            <button
              key={label}
              onClick={() => { setCurrentTtl(value); setShowTtlMenu(false); }}
              className={`px-3 py-1 rounded-full text-[10px] font-code border transition-all duration-200 ${
                currentTtl === value
                  ? 'bg-accent-glow/15 border-accent-glow/30 text-accent-glow'
                  : 'bg-elevated border-border-subtle text-ghost-dim hover:text-ghost-white'
              }`}
            >
              {label}
            </button>
          ))}
        </motion.div>
      )}

      <div className="flex items-end gap-2">
        {/* Ghost mode toggle */}
        <motion.button
          onClick={toggleEphemeral}
          className={`p-2.5 rounded-xl transition-all duration-200 flex-shrink-0 ${
            ephemeralMode
              ? 'bg-accent-glow/15 text-accent-glow border border-accent-glow/20'
              : 'text-ghost-dim hover:text-ghost-white hover:bg-elevated border border-transparent'
          }`}
          whileTap={{ scale: 0.9 }}
          title={ephemeralMode ? 'Ghost mode ON — messages disappear' : 'Ghost mode OFF'}
        >
          <Ghost size={18} />
        </motion.button>

        {/* TTL button */}
        <button
          onClick={() => setShowTtlMenu(!showTtlMenu)}
          className={`p-2.5 rounded-xl transition-all duration-200 flex-shrink-0 ${
            currentTtl > 0
              ? 'text-accent-glow hover:bg-accent-glow/10 border border-accent-glow/20'
              : 'text-ghost-dim hover:text-ghost-white hover:bg-elevated border border-transparent'
          }`}
          title="Set message timer"
        >
          <Clock size={18} />
        </button>

        {/* Input */}
        <div className="flex-1 relative">
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
            className="w-full bg-elevated text-ghost-white text-sm px-4 py-2.5 rounded-xl border border-border-subtle focus:border-accent-glow/30 focus:ring-1 focus:ring-accent-glow/10 outline-none resize-none transition-all duration-200 placeholder:text-ghost-dim/50 min-h-[40px] max-h-[120px]"
            style={{ height: 'auto', overflow: 'auto' }}
          />
        </div>

        {/* Send */}
        <motion.button
          onClick={handleSend}
          disabled={!inputText.trim()}
          className={`p-2.5 rounded-xl transition-all duration-200 flex-shrink-0 ${
            inputText.trim()
              ? 'bg-accent-glow text-void hover:bg-accent-glow/90'
              : 'bg-elevated text-ghost-dim/30 cursor-not-allowed'
          }`}
          whileTap={inputText.trim() ? { scale: 0.9 } : undefined}
        >
          <Send size={18} />
        </motion.button>
      </div>

      {/* Ephemeral indicator */}
      {ephemeralMode && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="mt-2 flex items-center gap-1.5 text-[10px] text-accent-glow/60 font-code"
        >
          <Ghost size={10} />
          <span>Ghost mode — messages will dissolve{currentTtl > 0 ? ` after ${formatTtl(currentTtl)}` : ''}</span>
        </motion.div>
      )}
    </div>
  );
}

function formatTtl(ms: number): string {
  if (ms < 60000) return `${ms / 1000}s`;
  if (ms < 3600000) return `${ms / 60000}m`;
  return `${ms / 3600000}h`;
}
