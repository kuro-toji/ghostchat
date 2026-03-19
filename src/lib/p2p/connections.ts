/**
 * GhostChat — Module 3.3: Connection Management
 * 
 * Manages peer connections with automatic transport selection,
 * NAT traversal via circuit relay, and connection health monitoring.
 * 
 * Dial:       libp2p.dial(peerId) — automatic transport selection
 * NAT:        AutoNAT detects reachability → circuit relay if needed
 * Upgrade:    DCuTR upgrades relayed → direct WebRTC
 * Retry:      exponential backoff: 1s, 2s, 4s, 8s, 16s, max 60s
 * Heartbeat:  ping every 30s, disconnect after 3 missed pings
 * Tor:        each peer = separate Tor circuit (IsolateDestAddr)
 */

import { getNode } from './node';
import { peerIdFromString } from '@libp2p/peer-id';
import type { Connection, Stream } from '@libp2p/interface';

/** Connection state for a peer */
export interface PeerConnection {
  peerId: string;
  status: 'connecting' | 'connected' | 'relayed' | 'disconnected' | 'failed';
  multiaddr: string | null;
  latencyMs: number | null;
  isRelayed: boolean;
  connectedAt: number | null;
  retryCount: number;
}

/** Retry configuration */
const RETRY_CONFIG = {
  baseDelay: 1000,      // 1 second
  maxDelay: 60000,      // 60 seconds
  maxRetries: 10,
  backoffMultiplier: 2,
};

/** Heartbeat config */
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const MAX_MISSED_PINGS = 3;

/** Active connections state */
const connections = new Map<string, PeerConnection>();
const heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>();

/** Connection event callbacks */
type ConnectionCallback = (peerId: string, status: PeerConnection['status']) => void;
const connectionCallbacks: Set<ConnectionCallback> = new Set();

/**
 * Dial a peer by PeerID string.
 * 
 * Automatic transport selection:
 *   1. Try direct WebRTC (non-Tor)
 *   2. Try direct WebSocket
 *   3. Fall back to circuit relay through another peer
 *   4. DCuTR attempts to upgrade relayed → direct
 * 
 * @param peerIdStr - Target peer's PeerID
 * @returns Connection info
 */
export async function dialPeer(peerIdStr: string): Promise<PeerConnection> {
  const node = getNode();
  if (!node) throw new Error('Node not initialized');
  
  // Check if already connected
  const existing = connections.get(peerIdStr);
  if (existing?.status === 'connected' || existing?.status === 'relayed') {
    return existing;
  }
  
  const connState: PeerConnection = {
    peerId: peerIdStr,
    status: 'connecting',
    multiaddr: null,
    latencyMs: null,
    isRelayed: false,
    connectedAt: null,
    retryCount: 0,
  };
  connections.set(peerIdStr, connState);
  notifyConnectionChange(peerIdStr, 'connecting');
  
  try {
    const peerId = peerIdFromString(peerIdStr);
    const connection = await node.dial(peerId);
    
    // Determine if relayed
    const remoteAddr = connection.remoteAddr.toString();
    const isRelayed = remoteAddr.includes('/p2p-circuit/');
    
    connState.status = isRelayed ? 'relayed' : 'connected';
    connState.multiaddr = remoteAddr;
    connState.isRelayed = isRelayed;
    connState.connectedAt = Date.now();
    connState.retryCount = 0;
    
    notifyConnectionChange(peerIdStr, connState.status);
    
    // Start heartbeat
    startHeartbeat(peerIdStr);
    
    // Measure latency
    try {
      const latency = await measureLatency(peerIdStr);
      connState.latencyMs = latency;
    } catch {
      // Latency measurement optional
    }
    
    console.log(`👻 Connected to ${peerIdStr.slice(0, 16)}... [${connState.status}]`);
    
    return connState;
  } catch (err) {
    connState.status = 'failed';
    connState.retryCount++;
    notifyConnectionChange(peerIdStr, 'failed');
    throw err;
  }
}

/**
 * Dial with automatic retry and exponential backoff.
 */
export async function dialWithRetry(peerIdStr: string): Promise<PeerConnection> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < RETRY_CONFIG.maxRetries; attempt++) {
    try {
      return await dialPeer(peerIdStr);
    } catch (err) {
      lastError = err as Error;
      
      const delay = Math.min(
        RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
        RETRY_CONFIG.maxDelay
      );
      
      console.log(`👻 Retry ${attempt + 1}/${RETRY_CONFIG.maxRetries} for ${peerIdStr.slice(0, 16)}... in ${delay}ms`);
      await sleep(delay);
    }
  }
  
  throw new Error(`Failed to connect after ${RETRY_CONFIG.maxRetries} attempts: ${lastError?.message}`);
}

/**
 * Open a protocol stream to a peer.
 * 
 * @param peerIdStr - Target peer
 * @param protocol - Protocol ID (e.g., '/ghostchat/1.0/message')
 * @returns Yamux stream for the protocol
 */
export async function openStream(
  peerIdStr: string,
  protocol: string
): Promise<Stream> {
  const node = getNode();
  if (!node) throw new Error('Node not initialized');
  
  const peerId = peerIdFromString(peerIdStr);
  const stream = await node.dialProtocol(peerId, protocol);
  return stream;
}

/**
 * Disconnect from a peer.
 */
export async function disconnectPeer(peerIdStr: string): Promise<void> {
  const node = getNode();
  if (!node) return;
  
  stopHeartbeat(peerIdStr);
  
  try {
    const peerId = peerIdFromString(peerIdStr);
    await node.hangUp(peerId);
  } catch {
    // Already disconnected
  }
  
  const connState = connections.get(peerIdStr);
  if (connState) {
    connState.status = 'disconnected';
  }
  notifyConnectionChange(peerIdStr, 'disconnected');
}

/**
 * Get connection info for a peer.
 */
export function getConnectionInfo(peerIdStr: string): PeerConnection | null {
  return connections.get(peerIdStr) ?? null;
}

/**
 * Get all active connections.
 */
export function getAllConnections(): PeerConnection[] {
  return Array.from(connections.values());
}

/**
 * Register callback for connection state changes.
 */
export function onConnectionChange(callback: ConnectionCallback): () => void {
  connectionCallbacks.add(callback);
  return () => connectionCallbacks.delete(callback);
}

/**
 * Measure round-trip latency to a peer via ping.
 */
export async function measureLatency(peerIdStr: string): Promise<number> {
  const node = getNode();
  if (!node) throw new Error('Node not initialized');
  
  const peerId = peerIdFromString(peerIdStr);
  const start = performance.now();
  await node.services.ping.ping(peerId);
  return Math.round(performance.now() - start);
}

// ─── Heartbeat ───────────────────────────────────────────────

function startHeartbeat(peerIdStr: string): void {
  stopHeartbeat(peerIdStr);
  
  let missedPings = 0;
  
  const timer = setInterval(async () => {
    try {
      await measureLatency(peerIdStr);
      missedPings = 0;
      
      const conn = connections.get(peerIdStr);
      if (conn) {
        conn.latencyMs = await measureLatency(peerIdStr);
      }
    } catch {
      missedPings++;
      console.warn(`👻 Missed ping ${missedPings}/${MAX_MISSED_PINGS} for ${peerIdStr.slice(0, 16)}...`);
      
      if (missedPings >= MAX_MISSED_PINGS) {
        console.warn(`👻 Peer unresponsive, disconnecting: ${peerIdStr.slice(0, 16)}...`);
        disconnectPeer(peerIdStr);
      }
    }
  }, HEARTBEAT_INTERVAL);
  
  heartbeatTimers.set(peerIdStr, timer);
}

function stopHeartbeat(peerIdStr: string): void {
  const timer = heartbeatTimers.get(peerIdStr);
  if (timer) {
    clearInterval(timer);
    heartbeatTimers.delete(peerIdStr);
  }
}

// ─── Utilities ───────────────────────────────────────────────

function notifyConnectionChange(peerId: string, status: PeerConnection['status']): void {
  for (const cb of connectionCallbacks) {
    cb(peerId, status);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
