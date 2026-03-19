/**
 * GhostChat — Session Manager
 * 
 * Manages the lifecycle of encrypted sessions with peers.
 * Each session contains a Double Ratchet state for E2E encryption.
 * 
 * Session lifecycle:
 *   1. New contact added → initiate handshake (Noise XX or X3DH)
 *   2. Handshake complete → Double Ratchet initialized
 *   3. Messages encrypted/decrypted through session's ratchet
 *   4. Session closed → keys wiped
 */

import {
  initializeAlice,
  initializeBob,
  ratchetEncrypt,
  ratchetDecrypt,
  type RatchetState,
  type RatchetMessage,
  generateX25519KeyPair,
} from '../crypto';
import type { Session, SessionStatus } from '../../types';

/** Active session with Double Ratchet state */
interface ActiveSession {
  /** Session metadata */
  info: Session;
  /** Session status */
  status: SessionStatus;
  /** Double Ratchet state */
  ratchet: RatchetState | null;
}

/** All active sessions indexed by peerId */
const sessions = new Map<string, ActiveSession>();

/** Session event callbacks */
type SessionCallback = (peerId: string, status: SessionStatus) => void;
const sessionCallbacks: Set<SessionCallback> = new Set();

/**
 * Create a new session with a peer.
 * 
 * @param peerId - Peer's PeerID
 * @returns Session info
 */
export function createSession(peerId: string): Session {
  const now = Date.now();
  
  const session: ActiveSession = {
    info: {
      peerId,
      createdAt: now,
      updatedAt: now,
      established: false,
      ephemeralDefault: false,
      defaultTtl: 0,
    },
    status: 'initializing',
    ratchet: null,
  };
  
  sessions.set(peerId, session);
  notifySessionChange(peerId, 'initializing');
  
  return session.info;
}

/**
 * Initialize session as Alice (initiator) after handshake.
 * 
 * @param peerId - Peer's PeerID
 * @param sharedSecret - 32-byte secret from Noise XX or X3DH
 * @param peerDHPublicKey - Peer's X25519 public key
 */
export function initSessionAsAlice(
  peerId: string,
  sharedSecret: Uint8Array,
  peerDHPublicKey: Uint8Array
): void {
  let session = sessions.get(peerId);
  if (!session) {
    createSession(peerId);
    session = sessions.get(peerId)!;
  }
  
  session.ratchet = initializeAlice(sharedSecret, peerDHPublicKey);
  session.status = 'active';
  session.info.established = true;
  session.info.updatedAt = Date.now();
  
  notifySessionChange(peerId, 'active');
  console.log(`👻 Session established with ${peerId.slice(0, 16)}... (as initiator)`);
}

/**
 * Initialize session as Bob (responder) after handshake.
 * 
 * @param peerId - Peer's PeerID 
 * @param sharedSecret - 32-byte secret from Noise XX or X3DH
 */
export function initSessionAsBob(
  peerId: string,
  sharedSecret: Uint8Array
): void {
  let session = sessions.get(peerId);
  if (!session) {
    createSession(peerId);
    session = sessions.get(peerId)!;
  }
  
  const ourDHKeyPair = generateX25519KeyPair();
  session.ratchet = initializeBob(sharedSecret, ourDHKeyPair);
  session.status = 'active';
  session.info.established = true;
  session.info.updatedAt = Date.now();
  
  notifySessionChange(peerId, 'active');
  console.log(`👻 Session established with ${peerId.slice(0, 16)}... (as responder)`);
}

/**
 * Encrypt a message for a peer using their session's Double Ratchet.
 * 
 * @param peerId - Recipient's PeerID
 * @param plaintext - Data to encrypt
 * @returns Encrypted ratchet message
 */
export function encryptForPeer(
  peerId: string,
  plaintext: Uint8Array
): RatchetMessage {
  const session = sessions.get(peerId);
  if (!session || !session.ratchet) {
    throw new Error(`No active session with ${peerId.slice(0, 16)}...`);
  }
  
  const message = ratchetEncrypt(session.ratchet, plaintext);
  session.info.updatedAt = Date.now();
  
  return message;
}

/**
 * Decrypt a message from a peer using their session's Double Ratchet.
 * 
 * @param peerId - Sender's PeerID
 * @param message - Encrypted ratchet message
 * @returns Decrypted plaintext
 */
export function decryptFromPeer(
  peerId: string,
  message: RatchetMessage
): Uint8Array {
  const session = sessions.get(peerId);
  if (!session || !session.ratchet) {
    throw new Error(`No active session with ${peerId.slice(0, 16)}...`);
  }
  
  const plaintext = ratchetDecrypt(session.ratchet, message);
  session.info.updatedAt = Date.now();
  
  return plaintext;
}

/**
 * Get session info for a peer.
 */
export function getSession(peerId: string): Session | null {
  return sessions.get(peerId)?.info ?? null;
}

/**
 * Get session status for a peer.
 */
export function getSessionStatus(peerId: string): SessionStatus | null {
  return sessions.get(peerId)?.status ?? null;
}

/**
 * Check if a session is established and active.
 */
export function hasActiveSession(peerId: string): boolean {
  const session = sessions.get(peerId);
  return session?.status === 'active' && session?.ratchet !== null;
}

/**
 * Close and wipe a session.
 */
export function closeSession(peerId: string): void {
  const session = sessions.get(peerId);
  if (session) {
    // Wipe ratchet state
    if (session.ratchet) {
      session.ratchet.rootKey.fill(0);
      session.ratchet.sendingChainKey.fill(0);
      session.ratchet.receivingChainKey.fill(0);
      session.ratchet.ourDHKeyPair.privateKey.fill(0);
      session.ratchet.skippedKeys.clear();
    }
    
    session.status = 'closed';
    notifySessionChange(peerId, 'closed');
  }
  
  sessions.delete(peerId);
}

/**
 * Get all active session peer IDs.
 */
export function getActiveSessions(): string[] {
  return Array.from(sessions.entries())
    .filter(([_, s]) => s.status === 'active')
    .map(([id]) => id);
}

/**
 * Set default ephemeral mode for a session.
 */
export function setEphemeralDefault(peerId: string, enabled: boolean): void {
  const session = sessions.get(peerId);
  if (session) {
    session.info.ephemeralDefault = enabled;
  }
}

/**
 * Set default TTL for messages in a session.
 */
export function setDefaultTtl(peerId: string, ttl: number): void {
  const session = sessions.get(peerId);
  if (session) {
    session.info.defaultTtl = ttl;
  }
}

/**
 * Register callback for session state changes.
 */
export function onSessionChange(callback: SessionCallback): () => void {
  sessionCallbacks.add(callback);
  return () => sessionCallbacks.delete(callback);
}

// ─── Internal ────────────────────────────────────────────────

function notifySessionChange(peerId: string, status: SessionStatus): void {
  for (const cb of sessionCallbacks) {
    cb(peerId, status);
  }
}
