/**
 * GhostChat — P2P Networking Module
 * 
 * Pure P2P networking — no VPS, no bootstrap servers you own.
 * Every GhostChat install = relay + DHT node + peer.
 * 
 *   3.1  Node           — libp2p initialization with all services
 *   3.2  Peer Discovery — Kademlia DHT, mDNS, manual peer add
 *   3.3  Connections    — dial, retry, heartbeat, relay detection
 *   3.4  Protocol       — GhostChat wire format over libp2p streams
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
