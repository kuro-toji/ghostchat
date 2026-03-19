import { motion } from "framer-motion";
import { WifiOff, Database, HardDrive } from "lucide-react";

export function StatusBar() {
  return (
    <motion.div
      className="h-7 min-h-[28px] flex items-center justify-between px-4 bg-surface border-t border-border-subtle text-[10px] font-code select-none"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.8, duration: 0.4 }}
    >
      <div className="flex items-center gap-4">
        <StatusItem icon={<WifiOff size={10} />} label="P2P: Offline" color="dim" />
        <StatusItem icon={<TorIcon />} label="Tor: Inactive" color="dim" />
      </div>
      <div className="flex items-center gap-1.5 text-ghost-dim/50">
        <span>🔒</span>
        <span>E2E Ready · Double Ratchet</span>
      </div>
      <div className="flex items-center gap-4">
        <StatusItem icon={<Database size={10} />} label="DB: Not initialized" color="dim" />
        <StatusItem icon={<HardDrive size={10} />} label="DHT: 0 peers" color="dim" />
      </div>
    </motion.div>
  );
}

function StatusItem({ icon, label, color }: { icon: React.ReactNode; label: string; color: "safe" | "danger" | "dim" | "glow" }) {
  const c = { safe: "text-accent-safe", danger: "text-accent-danger", dim: "text-ghost-dim/50", glow: "text-accent-glow" };
  return (
    <div className={`flex items-center gap-1.5 ${c[color]}`}>
      {icon}
      <span>{label}</span>
    </div>
  );
}

function TorIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="11" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
