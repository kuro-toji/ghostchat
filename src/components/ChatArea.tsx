import { motion } from "framer-motion";
import { Lock, Zap } from "lucide-react";
import { GhostLogo } from "./GhostLogo";

export function ChatArea() {
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
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="12" cy="12" r="11" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            }
            label="Tor Routed" sub="Your IP never exposed"
          />
          <FeatureChip icon={<Zap size={14} />} label="Pure P2P" sub="No servers · You ARE the network" />
        </motion.div>

        <motion.p
          className="text-ghost-dim/40 text-[10px] font-code mt-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5, duration: 0.5 }}
        >
          v0.1.0 · Phase 1 Shell
        </motion.p>
      </motion.div>

      <div className="absolute top-4 right-4 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-ghost-dim/30" />
        <div className="w-2 h-2 rounded-full bg-ghost-dim/20" />
        <div className="w-2 h-2 rounded-full bg-ghost-dim/10" />
      </div>
    </div>
  );
}

function FeatureChip({ icon, label, sub }: { icon: React.ReactNode; label: string; sub: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-surface/50 border border-border-subtle hover:border-accent-glow/20 transition-colors duration-300 cursor-default group">
      <div className="text-accent-glow/60 group-hover:text-accent-glow transition-colors duration-300">{icon}</div>
      <div>
        <p className="text-ghost-white/80 text-xs font-medium">{label}</p>
        <p className="text-ghost-dim/60 text-[10px] font-code">{sub}</p>
      </div>
    </div>
  );
}
