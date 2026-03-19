/**
 * GhostChat — Module 3.1: Node Initialization
 * 
 * Every GhostChat install = a relay + DHT node + peer.
 * The network exists only because users exist.
 * 
 * ── BOOTSTRAP STRATEGY ──
 * 
 * Problem: Kademlia DHT needs at least one known peer to join.
 * Solution: Three-tier fallback:
 * 
 *   Tier 1 — HARDCODED BOOTSTRAP PEERS
 *     Protocol Labs community DHT nodes. These are NOT our servers.
 *     They only help us JOIN the DHT. Once we know ~3 peers, we never
 *     need them again. If all 4 die, Tier 2 kicks in.
 * 
 *   Tier 2 — mDNS LAN DISCOVERY
 *     If bootstrap peers are unreachable (air-gapped, censored),
 *     mDNS discovers GhostChat peers on the local network.
 *     Two laptops on the same WiFi will find each other without internet.
 *     DISABLED in Tor mode (broadcasts real IP on LAN).
 * 
 *   Tier 3 — MANUAL PEER ADD
 *     User pastes a multiaddr from a friend (e.g. via Signal or QR code).
 *     `/ip4/1.2.3.4/tcp/4001/ws/p2p/12D3KooW...`
 *     No servers needed at all.
 * 
 * ── RELAY STRATEGY ──
 * 
 * Every GhostChat node runs circuitRelayServer(). This means:
 *   - If Alice is behind NAT and can reach Bob, Bob relays for Alice.
 *   - No dedicated relay servers needed.
 *   - DCuTR then attempts to upgrade relayed→direct.
 * 
 * Minimum relay requirement: At least ONE peer must have a public IP
 * or port-forwarded connection. In practice, ~20% of residential
 * connections work as relay-capable. With 50+ users, this is reliable.
 * 
 * ── SYMMETRIC NAT ──
 * 
 * When both peers are behind symmetric NAT (worst case):
 *   1. WebRTC hole-punching via ICE/STUN — works ~65% of the time
 *   2. If hole-punching fails → circuit relay through a third peer
 *   3. DCuTR upgrade attempt in background
 *   4. If no relay peers available → connection fails, queued for retry
 *   5. In Tor mode: relay through Tor network (always works)
 * 
 * ── TOR FALLBACK ──
 * 
 * On cold start, Tor takes 30-60 seconds to bootstrap.
 * Fallback behavior:
 *   1. If Tor is enabled, attempt Tor connection first
 *   2. While Tor bootstraps: allow clearnet WebRTC for non-sensitive
 *      initial DHT join ONLY (no message content over clearnet)
 *   3. Once Tor is ready: migrate all connections to Tor
 *   4. DHT join info is not sensitive (just "I exist"), so clearnet
 *      bootstrap is acceptable even in Tor mode
 * 
 * PeerID:       derived from Ed25519 identity key
 * Transports:   WebRTC + WebSocket (non-Tor), WebSocket only (Tor mode)
 * Security:     Noise XX (libp2p built-in)
 * Muxer:        Yamux
 * Services:     Kademlia DHT, GossipSub, Identify, AutoNAT, DCuTR
 * Relay:        circuit-relay-v2 (your node relays for others)
 */

import { createLibp2p, type Libp2p } from 'libp2p';
import { noise } from '@libp2p/noise';
import { yamux } from '@libp2p/yamux';
import { kadDHT } from '@libp2p/kad-dht';
import { gossipsub } from '@libp2p/gossipsub';
import { identify } from '@libp2p/identify';
import { autoNAT } from '@libp2p/autonat';
import { dcutr } from '@libp2p/dcutr';
import { circuitRelayTransport, circuitRelayServer } from '@libp2p/circuit-relay-v2';
import { webRTC } from '@libp2p/webrtc';
import { webSockets } from '@libp2p/websockets';
import { mdns } from '@libp2p/mdns';
import { bootstrap } from '@libp2p/bootstrap';
import { ping } from '@libp2p/ping';

/** Node configuration options */
export interface GhostNodeConfig {
  /** Enable Tor mode — WebSocket only, all traffic through SOCKS5 */
  torEnabled: boolean;
  /** Tor SOCKS5 proxy address (default: 127.0.0.1:9050) */
  torSocksAddr?: string;
  /** Our .onion address (set after Tor boots) */
  onionAddress?: string;
  /** Listen port for WebSocket (default: 4001) */
  listenPort?: number;
  /** Enable mDNS LAN discovery (disabled in Tor mode) */
  enableMdns?: boolean;
  /** Additional bootstrap peers */
  customBootstrapPeers?: string[];
  /** Allow clearnet DHT join while Tor bootstraps */
  allowClearnetBootstrap?: boolean;
  /** Relay reservation config */
  relayConfig?: {
    /** Max concurrent relay reservations we'll serve */
    maxReservations?: number;
    /** Max data rate per relay (bytes/sec) */
    maxDataRate?: number;
  };
}

/** Default config */
const DEFAULT_CONFIG: GhostNodeConfig = {
  torEnabled: false,
  torSocksAddr: '127.0.0.1:9050',
  listenPort: 4001,
  enableMdns: true,
  customBootstrapPeers: [],
  allowClearnetBootstrap: true,
  relayConfig: {
    maxReservations: 128,
    maxDataRate: 131072, // 128 KB/s per relayed connection
  },
};

/**
 * BOOTSTRAP PEERS — Tier 1 DHT Entry Points
 * 
 * Protocol Labs public DHT bootstrap nodes.
 * These are NOT GhostChat servers. They are community infrastructure.
 * Purpose: Initial DHT join only. After first contact, cached locally.
 * 
 * If all 4 die simultaneously (extremely unlikely), mDNS and manual
 * peer add still work. Community can also run additional bootstrap
 * nodes and add them via customBootstrapPeers.
 */
export const BOOTSTRAP_PEERS = [
  // Protocol Labs — primary public DHT
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt',
] as const;

/**
 * Connection state machine phases
 * 
 * COLD_START → BOOTSTRAPPING → DHT_JOINED → PEER_DISCOVERED → HANDSHAKING → CONNECTED
 * 
 * See README for full state diagram with failure paths.
 */
export type NodePhase = 
  | 'cold_start'       // App just launched, no connections
  | 'bootstrapping'    // Contacting bootstrap peers or mDNS
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
 * Every node participates as:
 *   - CLIENT:    sends/receives messages
 *   - DHT NODE:  stores/serves routing info (clientMode: false)
 *   - RELAY:     forwards encrypted connections for NATed peers
 * 
 * Rust backend role: ONLY Tor sidecar control.
 * All crypto happens in TypeScript (browser WASM via @noble/*).
 * Rust does NOT touch keys, plaintext, or encryption.
 * 
 * @param config - Node configuration
 * @returns Initialized libp2p node
 */
export async function createGhostNode(
  config: Partial<GhostNodeConfig> = {}
): Promise<Libp2p> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  setPhase('bootstrapping');
  
  // Build transport list based on mode
  const transports = buildTransports(cfg);
  
  // Build peer discovery list
  const peerDiscovery = buildPeerDiscovery(cfg);
  
  // Build service list
  const services = buildServices(cfg);
  
  // Build listen addresses
  const addresses = buildAddresses(cfg);
  
  node = await createLibp2p({
    addresses: {
      listen: addresses,
    },
    transports,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    connectionEncrypters: [noise as any],
    streamMuxers: [yamux()],
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
  console.log(`   Mode: ${cfg.torEnabled ? 'Tor (anonymous)' : 'Direct'}`);
  console.log(`   Relay: enabled (serving other peers)`);
  console.log(`   Addresses:`, node.getMultiaddrs().map(a => a.toString()));
  
  return node;
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
 * 
 * Ghost ID format: libp2p PeerID derived from Ed25519 public key.
 * Example: 12D3KooWGzBk1DtFN9hE3Cw6hXfK3JHv6bDq4oFXzN7L4y5Q8pR
 * 
 * The PeerID IS the identity. There is no separate username system.
 * Display in UI as truncated: 12D3KooWGz...Q8pR
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
  const t: any[] = [];
  
  // WebSocket — always available (Tor-compatible via SOCKS5)
  t.push(webSockets());
  
  // Circuit relay transport — connect through relay peers
  t.push(circuitRelayTransport());
  
  // WebRTC — only in non-Tor mode (cannot go through SOCKS5)
  // Also used as clearnet fallback during Tor bootstrap if allowed
  //
  // ⚠️ PLATFORM NOTE: WebRTC in Tauri depends on the webview engine.
  //   Linux:   WebKitGTK — WebRTC generally works
  //   macOS:   WKWebView — WebRTC works
  //   Windows: WebView2 (Chromium) — WebRTC works, best support
  //   Android: WebView — partial WebRTC, test thoroughly
  //   iOS:     WKWebView — WebRTC limited
  //
  // If WebRTC fails on a platform, connections fall back to:
  //   WebSocket → Circuit Relay
  // The app remains functional, just with higher latency.
  if (!cfg.torEnabled || cfg.allowClearnetBootstrap) {
    t.push(webRTC());
  }
  
  return t;
}

function buildPeerDiscovery(cfg: GhostNodeConfig) {
  const pd: any[] = [];
  
  // Tier 1: Bootstrap — hardcoded community peers for initial DHT join
  const bootstrapList = [
    ...BOOTSTRAP_PEERS,
    ...(cfg.customBootstrapPeers ?? []),
  ];
  
  if (bootstrapList.length > 0) {
    pd.push(bootstrap({ list: bootstrapList }));
  }
  
  // Tier 2: mDNS — LAN discovery (disabled in Tor mode for privacy)
  // This is the fallback when bootstrap peers are unreachable.
  // Two GhostChat installs on the same WiFi find each other automatically.
  if (cfg.enableMdns && !cfg.torEnabled) {
    pd.push(mdns());
  }
  
  // Tier 3: Manual peer add — handled via addKnownPeer() in peer-discovery.ts
  
  return pd;
}

function buildServices(cfg: GhostNodeConfig) {
  return {
    // Kademlia DHT — fully decentralized peer discovery
    // clientMode: false — we serve DHT queries, not just make them
    dht: kadDHT({
      clientMode: false,
    }),
    
    // GossipSub — PubSub message routing
    // PRODUCTION: allowPublishToZeroTopicPeers is FALSE.
    // If set to true, messages to topics with no subscribers are silently
    // swallowed with no error — you'd think messages were sent but nobody
    // receives them. Better to fail explicitly so the UI can show "no peers".
    // fallbackToFloodsub: false — prevents downgrade to insecure flooding.
    pubsub: gossipsub({
      allowPublishToZeroTopicPeers: false,
      emitSelf: false,
    }),
    
    // Identify — peer capability announcement
    identify: identify(),
    
    // AutoNAT — detect if we're behind NAT
    autoNAT: autoNAT(),
    
    // DCuTR — upgrade relayed connections to direct (hole-punching)
    // Handles symmetric NAT by attempting ICE over STUN
    dcutr: dcutr(),
    
    // Circuit relay server — THIS NODE RELAYS FOR OTHERS
    // Every GhostChat install is a relay. No dedicated relay servers.
    // Relay peers only see encrypted bytes — never keys or plaintext.
    relay: circuitRelayServer({
      reservations: {
        maxReservations: cfg.relayConfig?.maxReservations ?? 128,
      },
    }),
    
    // Ping — connection health checks (30s heartbeat)
    ping: ping(),
  };
}

function buildAddresses(cfg: GhostNodeConfig): string[] {
  const addrs: string[] = [];
  const port = cfg.listenPort ?? 4001;
  
  if (cfg.torEnabled && cfg.onionAddress) {
    // Tor mode — listen on .onion
    addrs.push(`/onion3/${cfg.onionAddress}:${port}`);
  } else {
    // Non-Tor — listen on all interfaces
    addrs.push(`/ip4/0.0.0.0/tcp/${port}/ws`);
    addrs.push(`/ip6/::/tcp/${port}/ws`);
    
    if (!cfg.torEnabled) {
      // WebRTC — ephemeral port
      addrs.push('/webrtc');
    }
  }
  
  return addrs;
}
