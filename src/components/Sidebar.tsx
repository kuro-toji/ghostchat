import { motion } from "framer-motion";
import { Search, UserPlus, Shield } from "lucide-react";
import { GhostLogo } from "./GhostLogo";

export function Sidebar() {
  return (
    <motion.aside
      className="w-[320px] min-w-[320px] h-full flex flex-col bg-surface border-r border-border-subtle"
      initial={{ x: -320 }}
      animate={{ x: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
        <GhostLogo size="sm" />
        <div className="flex items-center gap-2">
          <TorStatusIndicator />
          <button
            className="p-2 rounded-lg text-ghost-dim hover:text-ghost-white hover:bg-elevated transition-colors duration-200"
            title="Add Contact"
          >
            <UserPlus size={18} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-4 py-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ghost-dim" />
          <input
            type="text"
            placeholder="Search contacts..."
            className="w-full bg-elevated text-ghost-white text-sm pl-10 pr-4 py-2.5 rounded-xl border border-border-subtle focus:border-accent-glow/50 focus:ring-1 focus:ring-accent-glow/20 outline-none transition-all duration-200 placeholder:text-ghost-dim/60"
          />
        </div>
      </div>

      {/* Empty contact list */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.5, duration: 0.5 }}
          className="flex flex-col items-center gap-3"
        >
          <div className="w-16 h-16 rounded-2xl bg-elevated border border-border-subtle flex items-center justify-center">
            <Shield size={28} className="text-ghost-dim" />
          </div>
          <p className="text-ghost-dim text-sm font-mono">No contacts yet</p>
          <p className="text-ghost-dim/60 text-xs max-w-[200px]">
            Add a contact by sharing your PeerID or scanning a QR code
          </p>
          <button className="mt-2 px-4 py-2 bg-accent-glow/10 text-accent-glow text-xs font-mono rounded-lg border border-accent-glow/20 hover:bg-accent-glow/20 transition-colors duration-200">
            + Add First Contact
          </button>
        </motion.div>
      </div>

      {/* Identity preview */}
      <div className="px-4 py-3 border-t border-border-subtle">
        <div className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-elevated transition-colors duration-200 cursor-pointer">
          <div className="w-10 h-10 rounded-full bg-accent-glow/10 border border-accent-glow/20 flex items-center justify-center">
            <span className="text-accent-glow font-mono text-sm">G</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-ghost-white text-sm font-medium truncate">Your Identity</p>
            <p className="text-ghost-dim text-xs font-code truncate">Not initialized</p>
          </div>
        </div>
      </div>
    </motion.aside>
  );
}

function TorStatusIndicator() {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-elevated border border-border-subtle" title="Tor: Not connected">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" className="text-ghost-dim" />
        <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.5" className="text-ghost-dim" />
        <circle cx="12" cy="12" r="11" stroke="currentColor" strokeWidth="1.5" className="text-ghost-dim" />
      </svg>
      <span className="text-ghost-dim text-[10px] font-mono">TOR</span>
    </div>
  );
}
