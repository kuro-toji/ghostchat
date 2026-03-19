/**
 * GhostChat — P2P Networking Module
 * 
 * Pure P2P networking — no VPS, no servers.
 * Every GhostChat install = relay + DHT node + peer.
 */

// Module 3.1 — Node
export {
  createGhostNode,
  getNode,
  stopNode,
  isNodeRunning,
  getOurPeerId,
  getMultiaddrs,
  type GhostNodeConfig,
} from './node';

// Module 3.2 — Peer Discovery
export {
  startAnnouncing,
  stopAnnouncing,
  findPeer,
  dhtPut,
  dhtGet,
  onPeerDiscovered,
  getConnectedPeerCount,
  getConnectedPeers,
  addKnownPeer,
} from './peer-discovery';

// Module 3.3 — Connections
export {
  dialPeer,
  dialWithRetry,
  openStream,
  disconnectPeer,
  getConnectionInfo,
  getAllConnections,
  onConnectionChange,
  measureLatency,
  type PeerConnection,
} from './connections';

// Module 3.4 — Protocol
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
