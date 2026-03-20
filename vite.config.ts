import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          libp2p: ["libp2p", "@libp2p/crypto", "@libp2p/webrtc", "@libp2p/websockets", "@libp2p/yamux", "@libp2p/noise", "@libp2p/kad-dht"],
        },
      },
    },
  },
}));
