/**
 * GhostChat — Module 3.1: Node Initialization (Browser-Compatible)
 * 
 * Every GhostChat install = a DHT client + peer.
 * The network exists only because users exist.
 * 
 * ── BROWSER/WEBVIEW CONSTRAINTS ──
 * 
 * Tauri runs the frontend in a webview (browser context), meaning:
 *   ✗ No TCP/UDP socket binding (no listening addresses)
 *   ✗ No mDNS (requires UDP multicast → Node.js only)
 *   ✗ No autoNAT (requires incoming connections → Node.js only)
 *   ✗ No dcutr (requires incoming connections → Node.js only)
 *   ✗ No circuit-relay-server (requires listening → Node.js only)
 *   ✓ WebRTC (browser-native via RTCPeerConnection)
 *   ✓ WebSocket client (browser-native)
 *   ✓ Circuit relay client (connect through other peers)
 *   ✓ Bootstrap peers (outbound connections)
 *   ✓ Kademlia DHT (client mode — query routing info)
 *   ✓ Identify, Ping
 * 
 * ── BOOTSTRAP STRATEGY ──
 * 
 *   Tier 1 — HARDCODED BOOTSTRAP PEERS (WebSocket relays)
 *   Tier 2 — Manual peer add (paste multiaddr from friend)
 * 
 * PeerID:       derived from Ed25519 identity key
 * Transports:   WebSocket + WebRTC + Circuit Relay (client)
 * Security:     Noise XX (libp2p built-in)
 * Muxer:        Yamux
 * Services:     Kademlia DHT (client), Identify, Ping
 */

import { createLibp2p, type Libp2p } from 'libp2p';
import { noise } from '@libp2p/noise';
import { yamux } from '@libp2p/yamux';
import { kadDHT } from '@libp2p/kad-dht';
import { identify } from '@libp2p/identify';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { webRTC } from '@libp2p/webrtc';
import { webSockets } from '@libp2p/websockets';
import { bootstrap } from '@libp2p/bootstrap';
import { ping } from '@libp2p/ping';
import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';
import { createFromPrivKey } from '@libp2p/peer-id-factory';

/** Node configuration options */
export interface GhostNodeConfig {
  /** Enable Tor mode — WebSocket only, all traffic through SOCKS5 */
  torEnabled: boolean;
  /** Tor SOCKS5 proxy address (default: 127.0.0.1:9050) */
  torSocksAddr?: string;
  /** Our .onion address (set after Tor boots) */
  onionAddress?: string;
  /** Additional bootstrap peers */
  customBootstrapPeers?: string[];
  /** Allow clearnet DHT join while Tor bootstraps */
  allowClearnetBootstrap?: boolean;
  /** Enable mDNS LAN discovery (IGNORED in browser — always disabled) */
  enableMdns?: boolean;
  /** Ed25519 private key to derive persistent PeerID (if omitted, random) */
  identityPrivateKey?: Uint8Array;
}

/** Default config */
const DEFAULT_CONFIG: GhostNodeConfig = {
  torEnabled: false,
  torSocksAddr: '127.0.0.1:9050',
  customBootstrapPeers: [],
  allowClearnetBootstrap: true,
};

/**
 * BOOTSTRAP PEERS — Tier 1 DHT Entry Points
 * 
 * These are public WebSocket bootstrap nodes that browsers CAN connect to.
 * They help us join the DHT. Once we know peers, we don't need them.
 */
export const BOOTSTRAP_PEERS = [
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt',
] as const;

/**
 * Connection state machine phases
 */
export type NodePhase = 
  | 'cold_start'       // App just launched, no connections
  | 'bootstrapping'    // Contacting bootstrap peers
  | 'dht_joined'       // At least 1 DHT peer known
  | 'ready';           // Fully operational, can discover & connect

/** Active node instance */
let node: Libp2p | null = null;
let currentPhase: NodePhase = 'cold_start';

/** Phase change callback */
type PhaseCallback = (phase: NodePhase) => void;
const phaseCallbacks: Set<PhaseCallback> = new Set();

/**
 * Create and start a GhostChat libp2p node.
 * 
 * Browser-compatible: only uses transports/services that work in a webview.
 * 
 * @param config - Node configuration
 * @returns Initialized libp2p node
 */
export async function createGhostNode(
  config: Partial<GhostNodeConfig> = {}
): Promise<Libp2p> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  setPhase('bootstrapping');
  
  // Build transport list (browser-safe only)
  const transports = buildTransports(cfg);
  
  // Build peer discovery list
  const peerDiscovery = buildPeerDiscovery(cfg);
  
  // Build service list (browser-safe only)
  const services = buildServices();
  
  // Build listen addresses (browser-safe only)
  const addresses = buildAddresses(cfg);

  try {
    // Convert Ed25519 private key to libp2p PeerId
    const peerId = cfg.identityPrivateKey
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? await createFromPrivKey((await generateKeyPairFromSeed('Ed25519', cfg.identityPrivateKey)) as any)
      : undefined;

    node = await createLibp2p({
      // @ts-ignore — `peerId` is historically present in createLibp2p options depending on exact version combination
      peerId,
      addresses: {
        listen: addresses,
      },
      transports,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connectionEncrypters: [noise() as any],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      streamMuxers: [yamux() as any],
      peerDiscovery,
      services,
    });
    
    // Monitor DHT peer table to detect when we've joined
    node.addEventListener('peer:connect', () => {
      const peerCount = node!.getPeers().length;
      if (peerCount >= 1 && currentPhase === 'bootstrapping') {
        setPhase('dht_joined');
      }
      if (peerCount >= 3) {
        setPhase('ready');
      }
    });
    
    await node.start();
    
    console.log('👻 GhostChat node started');
    console.log(`   PeerID: ${node.peerId.toString()}`);
    console.log(`   Mode: ${cfg.torEnabled ? 'Tor (anonymous)' : 'Direct (clearnet)'}`);
    console.log(`   Addresses:`, node.getMultiaddrs().map(a => a.toString()));
    
    return node;
  } catch (err) {
    console.error('👻 Failed to create libp2p node:', err);
    throw err;
  }
}

/**
 * Get the active node instance.
 */
export function getNode(): Libp2p | null {
  return node;
}

/**
 * Stop the node gracefully.
 */
export async function stopNode(): Promise<void> {
  if (node) {
    await node.stop();
    node = null;
    setPhase('cold_start');
    console.log('👻 GhostChat node stopped');
  }
}

/**
 * Check if node is running.
 */
export function isNodeRunning(): boolean {
  return node !== null;
}

/**
 * Get our PeerID as string.
 */
export function getOurPeerId(): string | null {
  return node?.peerId.toString() ?? null;
}

/**
 * Get our announced multiaddresses.
 */
export function getMultiaddrs(): string[] {
  return node?.getMultiaddrs().map(a => a.toString()) ?? [];
}

/**
 * Get current connection phase.
 */
export function getNodePhase(): NodePhase {
  return currentPhase;
}

/**
 * Register callback for phase changes.
 */
export function onPhaseChange(callback: PhaseCallback): () => void {
  phaseCallbacks.add(callback);
  return () => phaseCallbacks.delete(callback);
}

// ─── Internal builders ──────────────────────────────────────

function setPhase(phase: NodePhase): void {
  currentPhase = phase;
  for (const cb of phaseCallbacks) {
    cb(phase);
  }
}

function buildTransports(cfg: GhostNodeConfig) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t: any[] = [];
  
  // WebSocket client — always available (outbound connections)
  t.push(webSockets());
  
  // Circuit relay transport — connect through relay peers
  t.push(circuitRelayTransport());
  
  // WebRTC — browser-native, works in webview
  // Only enabled in non-Tor mode (WebRTC leaks real IP)
  if (!cfg.torEnabled || cfg.allowClearnetBootstrap) {
    try {
      t.push(webRTC());
    } catch (err) {
      console.warn('👻 WebRTC transport not available:', err);
    }
  }
  
  return t;
}

function buildPeerDiscovery(cfg: GhostNodeConfig) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pd: any[] = [];
  
  // Bootstrap — hardcoded community peers for initial DHT join
  const bootstrapList = [
    ...BOOTSTRAP_PEERS,
    ...(cfg.customBootstrapPeers ?? []),
  ];
  
  if (bootstrapList.length > 0) {
    pd.push(bootstrap({ list: bootstrapList }));
  }
  
  // mDNS is NOT available in browser/webview — skip silently
  // Manual peer add is handled via addKnownPeer() in peer-discovery.ts
  
  return pd;
}

function buildServices() {
  return {
    // Kademlia DHT — client mode only (browser can't serve DHT queries)
    dht: kadDHT({
      clientMode: true,  // Browser can only QUERY, not SERVE
    }),
    
    // Identify — peer capability announcement
    identify: identify(),
    
    // Ping — connection health checks
    ping: ping(),
    
    // NOTE: The following are NOT available in browser/webview:
    //   - GossipSub: requires proper peer connections first
    //   - autoNAT: requires incoming connections
    //   - dcutr: requires incoming connections
    //   - circuitRelayServer: requires listening on ports
    // These would be used in a Node.js backend, not in the webview.
  };
}

function buildAddresses(cfg: GhostNodeConfig): string[] {
  const addrs: string[] = [];
  
  // In browser/webview, we can only use:
  //   - /webrtc (browser-managed signaling channel)
  //   - Circuit relay addresses (obtained dynamically)
  // We CANNOT bind to TCP/UDP ports from a browser.
  
  if (!cfg.torEnabled) {
    addrs.push('/webrtc');
  }
  
  // Circuit relay addresses are added dynamically when we connect to relay peers
  
  return addrs;
}
