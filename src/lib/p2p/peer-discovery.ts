/**
 * GhostChat — Module 3.2: DHT Peer Discovery
 * 
 * Kademlia DHT for fully decentralized peer discovery.
 * Same algorithm as BitTorrent and IPFS.
 * 
 * Protocol:    Kademlia DHT
 * Mode:        client + server (full participation)
 * Announce:    PeerID → multiaddr mapping, refreshed every 30 min
 * Find peer:   O(log n) hops across the network
 * mDNS:        LAN discovery (disabled in Tor mode)
 * Manual:      Paste PeerID directly — most private option
 */

import { getNode } from './node';
import { peerIdFromString } from '@libp2p/peer-id';

/** Announce refresh interval (30 minutes) */
const ANNOUNCE_INTERVAL = 30 * 60 * 1000;

/** Announce timer */
let announceTimer: ReturnType<typeof setInterval> | null = null;

/** Discovered peers callback registry */
type PeerDiscoveredCallback = (peerId: string, addrs: string[]) => void;
const discoveryCallbacks: Set<PeerDiscoveredCallback> = new Set();

/**
 * Start announcing ourselves to the DHT.
 * 
 * Publishes our PeerID → multiaddr mapping so other peers can find us.
 * In Tor mode, multiaddr = .onion address.
 * Refreshes every 30 minutes.
 */
export async function startAnnouncing(): Promise<void> {
  const node = getNode();
  if (!node) throw new Error('Node not initialized');
  
  // Initial announce
  await announceToNetwork();
  
  // Periodic refresh
  announceTimer = setInterval(async () => {
    try {
      await announceToNetwork();
    } catch (err) {
      console.warn('DHT announce refresh failed:', err);
    }
  }, ANNOUNCE_INTERVAL);
  
  // Listen for peer discovery events
  node.addEventListener('peer:discovery', (evt) => {
    const peerId = evt.detail.id.toString();
    const addrs = evt.detail.multiaddrs?.map(a => a.toString()) ?? [];
    
    console.log(`👻 Peer discovered: ${peerId.slice(0, 16)}...`);
    
    for (const cb of discoveryCallbacks) {
      cb(peerId, addrs);
    }
  });
}

/**
 * Stop DHT announcements.
 */
export function stopAnnouncing(): void {
  if (announceTimer) {
    clearInterval(announceTimer);
    announceTimer = null;
  }
}

/**
 * Find a peer by their PeerID string.
 * 
 * Queries the DHT: "where is PeerID xyz?"
 * Returns their multiaddresses (IP + port, or .onion in Tor mode).
 * O(log n) hops across the network.
 * 
 * @param peerIdStr - Base58 PeerID string (shared out-of-band: QR, link, text)
 * @returns Array of multiaddr strings, or empty if not found
 */
export async function findPeer(peerIdStr: string): Promise<string[]> {
  const node = getNode();
  if (!node) throw new Error('Node not initialized');
  
  try {
    const peerId = peerIdFromString(peerIdStr);
    const peerInfo = await node.peerRouting.findPeer(peerId);
    
    return peerInfo.multiaddrs.map(a => a.toString());
  } catch (err) {
    console.warn(`Peer not found in DHT: ${peerIdStr.slice(0, 16)}...`, err);
    return [];
  }
}

/**
 * Store a value in the DHT (used for pre-key bundles).
 * 
 * @param key - DHT key bytes
 * @param value - Value to store
 */
export async function dhtPut(key: Uint8Array, value: Uint8Array): Promise<void> {
  const node = getNode();
  if (!node) throw new Error('Node not initialized');
  
  await node.contentRouting.put(key, value);
}

/**
 * Retrieve a value from the DHT.
 * 
 * @param key - DHT key bytes
 * @returns Stored value, or null if not found
 */
export async function dhtGet(key: Uint8Array): Promise<Uint8Array | null> {
  const node = getNode();
  if (!node) throw new Error('Node not initialized');
  
  try {
    const result = await node.contentRouting.get(key);
    return result;
  } catch {
    return null;
  }
}

/**
 * Register a callback for peer discovery events.
 */
export function onPeerDiscovered(callback: PeerDiscoveredCallback): () => void {
  discoveryCallbacks.add(callback);
  return () => discoveryCallbacks.delete(callback);
}

/**
 * Get the number of connected peers.
 */
export function getConnectedPeerCount(): number {
  const node = getNode();
  return node?.getConnections().length ?? 0;
}

/**
 * Get list of connected peer IDs.
 */
export function getConnectedPeers(): string[] {
  const node = getNode();
  if (!node) return [];
  
  return node.getConnections().map(conn => conn.remotePeer.toString());
}

/**
 * Manually add a known peer address.
 * Most private option — skips DHT entirely.
 * 
 * @param peerIdStr - Peer's PeerID
 * @param multiaddr - Peer's multiaddr string
 */
export async function addKnownPeer(peerIdStr: string, multiaddr: string): Promise<void> {
  const node = getNode();
  if (!node) throw new Error('Node not initialized');
  
  const peerId = peerIdFromString(peerIdStr);
  const { multiaddr: ma } = await import('@multiformats/multiaddr');
  
  await node.peerStore.merge(peerId, {
    multiaddrs: [ma(multiaddr)],
  });
}

// ─── Internal ────────────────────────────────────────────────

async function announceToNetwork(): Promise<void> {
  const node = getNode();
  if (!node) return;
  
  try {
    // Actually provide our address to the DHT
    // @ts-ignore - dht service typing might be missing
    await node.services.dht.provide(node.peerId.toBytes());
  } catch (err) {
    console.warn('DHT announce failed:', err);
  }

  // The DHT automatically announces our presence through
  // the routing table refresh mechanism.
  // We can also explicitly provide content to make ourselves findable.
  const ourPeerId = node.peerId.toString();
  console.log(`👻 DHT announce: ${ourPeerId.slice(0, 16)}... with ${node.getMultiaddrs().length} addrs`);
}
