/**
 * GhostChat — Main Application
 * 
 * Root layout with modals, ambient effects, and all connected components.
 */

import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { StatusBar } from './components/StatusBar';
import { AddContactModal } from './components/AddContactModal';
import { SettingsModal } from './components/SettingsModal';
import { KeyVerificationModal } from './components/KeyVerificationModal';
import { useGhostChat } from './hooks/useGhostChat';

export default function App() {
  useGhostChat();
  
  return (
    <div className="flex flex-col h-screen w-screen bg-void overflow-hidden select-none">
      {/* Main layout */}
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <ChatArea />
      </div>
      <StatusBar />

      {/* Ambient glow effects */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-accent-glow/3 rounded-full blur-[120px]" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-accent-glow/2 rounded-full blur-[150px]" />
      </div>

      {/* Ghost noise texture */}
      <div className="pointer-events-none fixed inset-0 z-0 ghost-noise opacity-[0.015]" />

      {/* Modals */}
      <AddContactModal />
      <SettingsModal />
      <KeyVerificationModal />
    </div>
  );
}
