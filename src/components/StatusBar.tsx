import { motion } from "framer-motion";
import { WifiOff, Database, HardDrive } from "lucide-react";
import { useAppStore } from "../stores";

export function StatusBar() {
  const torStatus = useAppStore((s) => s.torStatus);
  const torProgress = useAppStore((s) => s.torProgress);
  const nodeOnline = useAppStore((s) => s.nodeOnline);
  const peerCount = useAppStore((s) => s.peerCount);
  const dbReady = useAppStore((s) => s.dbReady);

  const torLabel = torStatus === 'connected' ? `Tor: Connected (${torProgress}%)` 
    : torStatus === 'bootstrapping' ? `Tor: ${torProgress}%`
    : 'Tor: Inactive';

  const p2pLabel = nodeOnline ? 'P2P: Online' : 'P2P: Offline';
  const dbLabel = dbReady ? 'DB: Ready' : 'DB: Not initialized';
  const dhtLabel = `DHT: ${peerCount} peers`;

  return (
    <motion.div
      className="h-7 min-h-[28px] flex items-center justify-between px-4 bg-surface border-t border-border-subtle text-[10px] font-code select-none"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.8, duration: 0.4 }}
    >
      <div className="flex items-center gap-4">
        <StatusItem 
          icon={<WifiOff size={10} />} 
          label={p2pLabel} 
          color={nodeOnline ? "safe" : "dim"} 
        />
        <StatusItem 
          icon={<TorIcon />} 
          label={torLabel} 
          color={torStatus === 'connected' ? "safe" : torStatus === 'bootstrapping' ? "glow" : "dim"} 
        />
      </div>
      <div className="flex items-center gap-1.5 text-ghost-dim/50">
        <span>🔒</span>
        <span>E2E Ready · Double Ratchet</span>
      </div>
      <div className="flex items-center gap-4">
        <StatusItem icon={<Database size={10} />} label={dbLabel} color={dbReady ? "safe" : "dim"} />
        <StatusItem icon={<HardDrive size={10} />} label={dhtLabel} color={peerCount > 0 ? "safe" : "dim"} />
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
