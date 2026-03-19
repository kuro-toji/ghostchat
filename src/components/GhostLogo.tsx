import { motion } from "framer-motion";

export function GhostLogo({ size = "lg" }: { size?: "sm" | "md" | "lg" }) {
  const dims = {
    sm: { icon: 32, text: "text-lg" },
    md: { icon: 48, text: "text-2xl" },
    lg: { icon: 80, text: "text-4xl" },
  };
  const { icon, text } = dims[size];

  return (
    <motion.div
      className="flex flex-col items-center gap-4"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: "easeOut" }}
    >
      <motion.div
        className="animate-ghost-glow"
        initial={{ scale: 0.8 }}
        animate={{ scale: 1 }}
        transition={{ duration: 1, ease: "easeOut" }}
      >
        <svg width={icon} height={icon} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M50 10C30.67 10 15 25.67 15 45V80C15 82.5 17 84 19 83L28 76C30 74.5 33 74.5 35 76L42 82C44 83.5 47 83.5 49 82L50 81L51 82C53 83.5 56 83.5 58 82L65 76C67 74.5 70 74.5 72 76L81 83C83 84 85 82.5 85 80V45C85 25.67 69.33 10 50 10Z"
            fill="url(#ghostGradient)" fillOpacity="0.9"
          />
          <circle cx="38" cy="42" r="6" fill="#080808" />
          <circle cx="40" cy="40" r="2.5" fill="#7c6aff" />
          <circle cx="62" cy="42" r="6" fill="#080808" />
          <circle cx="64" cy="40" r="2.5" fill="#7c6aff" />
          <path
            d="M50 10C30.67 10 15 25.67 15 45V80C15 82.5 17 84 19 83L28 76C30 74.5 33 74.5 35 76L42 82C44 83.5 47 83.5 49 82L50 81L51 82C53 83.5 56 83.5 58 82L65 76C67 74.5 70 74.5 72 76L81 83C83 84 85 82.5 85 80V45C85 25.67 69.33 10 50 10Z"
            fill="url(#ghostShine)" fillOpacity="0.15"
          />
          <defs>
            <linearGradient id="ghostGradient" x1="50" y1="10" x2="50" y2="85" gradientUnits="userSpaceOnUse">
              <stop stopColor="#e8e8f0" />
              <stop offset="1" stopColor="#a0a0b8" />
            </linearGradient>
            <linearGradient id="ghostShine" x1="30" y1="10" x2="70" y2="85" gradientUnits="userSpaceOnUse">
              <stop stopColor="#7c6aff" />
              <stop offset="1" stopColor="transparent" />
            </linearGradient>
          </defs>
        </svg>
      </motion.div>

      <motion.h1
        className={`${text} font-mono font-bold text-ghost-white tracking-wider animate-ghost-glow`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.8 }}
      >
        Ghost<span className="text-accent-glow">Chat</span>
      </motion.h1>

      {size === "lg" && (
        <motion.p
          className="text-ghost-dim text-sm font-mono tracking-widest uppercase"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.8 }}
        >
          No servers · No trace · Pure P2P
        </motion.p>
      )}
    </motion.div>
  );
}
