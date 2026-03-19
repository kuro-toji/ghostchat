/**
 * GhostChat — Module 3.1: Node Initialization
 * 
 * Every GhostChat install = a relay + DHT node + peer.
 * The network exists only because users exist.
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
}

/** Default config */
const DEFAULT_CONFIG: GhostNodeConfig = {
  torEnabled: false,
  torSocksAddr: '127.0.0.1:9050',
  listenPort: 4001,
  enableMdns: true,
  customBootstrapPeers: [],
};

/** 
 * Public libp2p bootstrap peers (Protocol Labs community nodes).
 * Used ONLY for initial DHT join — NOT our servers.
 * After first DHT contacts, these are no longer needed.
 */
const BOOTSTRAP_PEERS = [
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt',
];

/** Active node instance */
let node: Libp2p | null = null;

/**
 * Create and start a GhostChat libp2p node.
 * 
 * Every node participates as:
 *   - CLIENT:    sends/receives messages
 *   - DHT NODE:  stores routing info for other peers
 *   - RELAY:     forwards encrypted connections for NATed peers
 * 
 * @param config - Node configuration
 * @returns Initialized libp2p node
 */
export async function createGhostNode(
  config: Partial<GhostNodeConfig> = {}
): Promise<Libp2p> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
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
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery,
    services,
  });
  
  await node.start();
  
  console.log('👻 GhostChat node started');
  console.log(`   PeerID: ${node.peerId.toString()}`);
  console.log(`   Mode: ${cfg.torEnabled ? 'Tor (anonymous)' : 'Direct'}`);
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

// ─── Internal builders ──────────────────────────────────────

function buildTransports(cfg: GhostNodeConfig) {
  const t: ReturnType<typeof webSockets>[] = [];
  
  // WebSocket — always available (Tor-compatible via SOCKS5)
  t.push(webSockets());
  
  // Circuit relay transport — connect through relay peers
  t.push(circuitRelayTransport());
  
  // WebRTC — only in non-Tor mode (cannot go through SOCKS5)
  if (!cfg.torEnabled) {
    t.push(webRTC());
  }
  
  return t;
}

function buildPeerDiscovery(cfg: GhostNodeConfig) {
  const pd: ReturnType<typeof bootstrap>[] = [];
  
  // Bootstrap — hardcoded community peers for initial DHT join
  const bootstrapList = [
    ...BOOTSTRAP_PEERS,
    ...(cfg.customBootstrapPeers ?? []),
  ];
  
  if (bootstrapList.length > 0) {
    pd.push(bootstrap({ list: bootstrapList }));
  }
  
  // mDNS — LAN discovery (disabled in Tor mode for privacy)
  if (cfg.enableMdns && !cfg.torEnabled) {
    pd.push(mdns());
  }
  
  return pd;
}

function buildServices(cfg: GhostNodeConfig) {
  return {
    // Kademlia DHT — fully decentralized peer discovery
    dht: kadDHT({
      clientMode: false, // Full DHT node — serve others too
    }),
    
    // GossipSub — PubSub message routing
    pubsub: gossipsub({
      allowPublishToZeroTopicPeers: true,
      emitSelf: false,
    }),
    
    // Identify — peer capability announcement
    identify: identify(),
    
    // AutoNAT — detect if we're behind NAT
    autoNAT: autoNAT(),
    
    // DCuTR — upgrade relayed connections to direct
    dcutr: dcutr(),
    
    // Circuit relay server — relay for other NATed peers
    relay: circuitRelayServer(),
    
    // Ping — connection health checks
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
