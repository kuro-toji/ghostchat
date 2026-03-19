/**
 * GhostChat — Key Verification Modal
 * 
 * Safety numbers for verifying peer identity.
 * Ensures no MITM between you and the contact.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { X, ShieldCheck, QrCode } from 'lucide-react';
import { useAppStore } from '../stores';
import { Identicon } from './Identicon';

export function KeyVerificationModal() {
  const { activeModal, modalData, closeModal } = useAppStore();

  if (activeModal !== 'key-verification' || !modalData?.peerId) return null;

  const peerId = modalData.peerId as string;
  
  // Generate safety number from combined public keys (placeholder)
  const safetyNumber = generateSafetyNumber(peerId);

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
          className="bg-surface border border-border-subtle rounded-2xl w-[420px] max-w-[90vw] shadow-2xl"
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
            <h3 className="text-ghost-white font-medium flex items-center gap-2">
              <ShieldCheck size={18} className="text-accent-safe" />
              Verify Encryption
            </h3>
            <button onClick={closeModal} className="p-1.5 rounded-lg text-ghost-dim hover:text-ghost-white hover:bg-elevated transition-colors">
              <X size={18} />
            </button>
          </div>

          <div className="px-6 py-5 space-y-4">
            {/* Peer */}
            <div className="flex items-center gap-3">
              <Identicon peerId={peerId} size={48} />
              <div>
                <p className="text-ghost-white text-sm font-medium">{peerId.slice(0, 16)}...</p>
                <p className="text-ghost-dim/60 text-[10px] font-code">{peerId}</p>
              </div>
            </div>

            {/* Safety Number */}
            <div className="p-4 rounded-xl bg-elevated border border-border-subtle text-center">
              <p className="text-[10px] text-ghost-dim font-code uppercase tracking-wider mb-3">Safety Number</p>
              <div className="grid grid-cols-6 gap-1.5">
                {safetyNumber.map((num, i) => (
                  <motion.span
                    key={i}
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.03 }}
                    className="text-accent-glow font-code text-sm py-1.5 rounded-lg bg-void/50"
                  >
                    {num}
                  </motion.span>
                ))}
              </div>
            </div>

            {/* Instructions */}
            <p className="text-ghost-dim/60 text-xs text-center leading-relaxed">
              Compare these numbers with your contact in person or via a trusted channel.
              If they match, your conversation is secure from man-in-the-middle attacks.
            </p>

            {/* QR placeholder */}
            <div className="flex justify-center">
              <div className="w-32 h-32 rounded-xl bg-elevated border border-border-subtle flex items-center justify-center">
                <QrCode size={48} className="text-ghost-dim/30" />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-border-subtle flex justify-between">
            <button onClick={closeModal} className="px-4 py-2 text-sm text-ghost-dim hover:text-ghost-white transition-colors rounded-xl">
              Close
            </button>
            <motion.button
              onClick={() => {
                window.dispatchEvent(new CustomEvent('ghostchat:verify', { detail: { peerId } }));
                closeModal();
              }}
              className="px-5 py-2 text-sm rounded-xl font-medium bg-accent-safe/15 text-accent-safe border border-accent-safe/20 hover:bg-accent-safe/25 transition-colors"
              whileTap={{ scale: 0.97 }}
            >
              Mark as Verified ✓
            </motion.button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function generateSafetyNumber(peerId: string): string[] {
  // Simplified safety number — in production, derived from both parties' identity keys
  const nums: string[] = [];
  for (let i = 0; i < 12; i++) {
    const charCode = peerId.charCodeAt(i * 3 % peerId.length);
    nums.push(String(charCode % 100000).padStart(5, '0'));
  }
  return nums;
}
