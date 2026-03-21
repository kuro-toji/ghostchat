/**
 * GhostChat — P2P Networking Module
 * 
 * Pure P2P networking — Rust backend handles TCP/mDNS/DHT.
 * Frontend communicates via Tauri IPC (invoke/listen).
 */

// Module 3.4 — Protocol (IPC version)
export {
  registerProtocolHandler,
  sendWireMessage,
  onMessage,
  GHOSTCHAT_PROTOCOL,
  type WireMessage,
} from './protocol';

// Phase 4 — X3DH Pre-Key Bundles
export {
  publishPreKeyBundle,
  fetchPreKeyBundle,
  performX3DHInitiator,
  performX3DHResponder,
  startPreKeyRefresh,
  stopPreKeyRefresh,
} from './x3dh';

// Phase 4 — Session Manager
export {
  createSession,
  initSessionAsAlice,
  initSessionAsBob,
  encryptForPeer,
  decryptFromPeer,
  getSession,
  getSessionStatus,
  hasActiveSession,
  closeSession,
  getActiveSessions,
  setEphemeralDefault,
  setDefaultTtl,
  onSessionChange,
} from './session-manager';

// Phase 4 — Message Service
export {
  initMessageService,
  sendTextMessage,
  flushQueuedMessages,
  onIncomingMessage,
  onOutgoingMessage,
} from './message-service';

// Phase 8 — Ghost Mode
export {
  applyGhostMode,
  startDissolveTimer,
  cancelDissolveTimer,
  cancelAllDissolveTimers,
  triggerReadExpiration,
  getTtlPresets,
  formatTtl,
  DEFAULT_GHOST_CONFIG,
  type GhostConfig,
} from './ghost-mode';
