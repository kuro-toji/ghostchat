/**
 * GhostChat — Add Contact Modal
 */

import { motion, AnimatePresence } from 'framer-motion';
import { X, UserPlus, Copy } from 'lucide-react';
import { useAppStore } from '../stores';
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

export function AddContactModal() {
  const { activeModal, closeModal } = useAppStore();
  const ourPeerId = useAppStore((s) => s.ourPeerId);
  const [peerIdInput, setPeerIdInput] = useState('');
  const [multiaddrInput, setMultiaddrInput] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [copied, setCopied] = useState(false);
  const [listenAddrs, setListenAddrs] = useState<string[]>([]);

  useEffect(() => {
    if (activeModal === 'add-contact') {
      invoke<string[]>('get_listen_addrs').then(setListenAddrs).catch(() => {});
    }
  }, [activeModal]);

  if (activeModal !== 'add-contact') return null;

  const handleAdd = () => {
    if (!peerIdInput.trim()) return;
    window.dispatchEvent(new CustomEvent('ghostchat:add-contact', {
      detail: {
        peerId: peerIdInput.trim(),
        displayName: displayName.trim(),
        multiaddr: multiaddrInput.trim() || null,
      },
    }));
    closeModal();
  };

  const copyOurId = async () => {
    if (ourPeerId) {
      try {
        await navigator.clipboard.writeText(ourPeerId);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Fallback for Tauri
        try {
          const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
          await writeText(ourPeerId);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch (e) {
          console.error('Copy failed:', e);
        }
      }
    }
  };

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
          className="bg-surface border border-border-subtle rounded-2xl w-[440px] max-w-[90vw] shadow-2xl"
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
            <h3 className="text-ghost-white font-medium flex items-center gap-2">
              <UserPlus size={18} className="text-accent-glow" />
              Add Contact
            </h3>
            <button onClick={closeModal} className="p-1.5 rounded-lg text-ghost-dim hover:text-ghost-white hover:bg-elevated transition-colors">
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div className="px-6 py-5 space-y-4">
            {/* Your PeerID */}
            <div className="p-3 rounded-xl bg-elevated border border-border-subtle">
              <p className="text-[10px] text-ghost-dim font-code uppercase tracking-wider mb-1.5">Your PeerID — share this</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs text-accent-glow font-code break-all leading-relaxed">
                  {ourPeerId || 'Not initialized'}
                </code>
                <button
                  onClick={copyOurId}
                  className="p-2 rounded-lg text-ghost-dim hover:text-accent-glow hover:bg-accent-glow/10 transition-colors flex-shrink-0"
                  title="Copy PeerID"
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
            </div>

            {/* Our Listen Addresses */}
            {listenAddrs.length > 0 && (
              <div className="p-3 rounded-xl bg-elevated border border-border-subtle">
                <p className="text-[10px] text-ghost-dim font-code uppercase tracking-wider mb-1.5">Your Address — share with remote peers</p>
                {listenAddrs.map((addr, i) => (
                  <code key={i} className="block text-[10px] text-accent-glow/70 font-code break-all leading-relaxed">
                    {addr}/p2p/{ourPeerId}
                  </code>
                ))}
              </div>
            )}

            {/* Peer ID input */}
            <div>
              <label className="text-xs text-ghost-dim font-code block mb-1.5">Contact's PeerID</label>
              <input
                type="text"
                value={peerIdInput}
                onChange={(e) => setPeerIdInput(e.target.value)}
                placeholder="Paste their PeerID here..."
                className="w-full bg-elevated text-ghost-white text-sm px-4 py-2.5 rounded-xl border border-border-subtle focus:border-accent-glow/30 outline-none transition-all placeholder:text-ghost-dim/40 font-code"
              />
            </div>

            {/* Multiaddr input */}
            <div>
              <label className="text-xs text-ghost-dim font-code block mb-1.5">Multiaddr (for internet peers, optional for LAN)</label>
              <input
                type="text"
                value={multiaddrInput}
                onChange={(e) => setMultiaddrInput(e.target.value)}
                placeholder="/ip4/1.2.3.4/tcp/4001/p2p/12D3KooW..."
                className="w-full bg-elevated text-ghost-white text-sm px-4 py-2.5 rounded-xl border border-border-subtle focus:border-accent-glow/30 outline-none transition-all placeholder:text-ghost-dim/40 font-code"
              />
            </div>

            {/* Display name */}
            <div>
              <label className="text-xs text-ghost-dim font-code block mb-1.5">Display Name (optional)</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="How should they appear?"
                className="w-full bg-elevated text-ghost-white text-sm px-4 py-2.5 rounded-xl border border-border-subtle focus:border-accent-glow/30 outline-none transition-all placeholder:text-ghost-dim/40"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-border-subtle flex justify-end gap-3">
            <button
              onClick={closeModal}
              className="px-4 py-2 text-sm text-ghost-dim hover:text-ghost-white transition-colors rounded-xl"
            >
              Cancel
            </button>
            <motion.button
              onClick={handleAdd}
              disabled={!peerIdInput.trim()}
              className={`px-5 py-2 text-sm rounded-xl font-medium transition-all duration-200 ${
                peerIdInput.trim()
                  ? 'bg-accent-glow text-void hover:bg-accent-glow/90'
                  : 'bg-elevated text-ghost-dim/30 cursor-not-allowed'
              }`}
              whileTap={peerIdInput.trim() ? { scale: 0.97 } : undefined}
            >
              Add Contact
            </motion.button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function Check({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent-safe">
      <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
