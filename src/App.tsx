import { motion } from "framer-motion";
import { Sidebar } from "./components/Sidebar";
import { ChatArea } from "./components/ChatArea";
import { StatusBar } from "./components/StatusBar";

function App() {
  return (
    <div className="h-screen w-screen flex flex-col bg-void overflow-hidden ghost-noise">
      <div className="flex flex-1 overflow-hidden relative z-10">
        <Sidebar />
        <ChatArea />
      </div>
      <StatusBar />
      <motion.div
        className="fixed inset-0 pointer-events-none z-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 2 }}
      >
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-accent-glow/[0.03] blur-[120px]" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full bg-accent-glow/[0.02] blur-[100px]" />
      </motion.div>
    </div>
  );
}

export default App;
