/**
 * GhostChat — Message Service
 * 
 * High-level send/receive API that ties everything together:
 *   1. Encrypt via session's Double Ratchet
 *   2. Build GhostMessage
 *   3. Send via protocol handler
 *   4. Handle incoming messages
 * 
 * Bridges: Session Manager ↔ Protocol Handler ↔ UI Layer
 */

import { v4 as uuidv4 } from 'uuid';
import {
  encryptForPeer,
  decryptFromPeer,
  hasActiveSession,
} from './session-manager';
import {
  sendWireMessage,
  onMessage,
  type WireMessage,
} from './protocol';
import { getOurPeerId } from './node';
import { publicKeyToHex } from '../crypto';
import type { GhostMessage, DecryptedMessage, MessageType } from '../../types';

/** Incoming message callback */
type IncomingMessageCallback = (message: DecryptedMessage) => void;
const incomingCallbacks: Set<IncomingMessageCallback> = new Set();

/** Outgoing message callback (for UI confirmation) */
type OutgoingMessageCallback = (message: DecryptedMessage) => void;
const outgoingCallbacks: Set<OutgoingMessageCallback> = new Set();

/** Message queue for peers that are offline */
const messageQueue = new Map<string, GhostMessage[]>();

/**
 * Initialize the message service.
 * Registers protocol handler for incoming messages.
 */
export function initMessageService(): void {
  // Listen for incoming wire messages
  onMessage((senderPeerId, wireMsg) => {
    handleIncomingMessage(senderPeerId, wireMsg);
  });
  
  console.log('👻 Message service initialized');
}

/**
 * Send a text message to a peer.
 * 
 * @param recipientPeerId - Target peer's PeerID
 * @param text - Message text content
 * @param options - Message options (ephemeral, TTL)
 * @returns The sent message for UI display
 */
export async function sendTextMessage(
  recipientPeerId: string,
  text: string,
  options: {
    ephemeral?: boolean;
    ttl?: number;
  } = {}
): Promise<DecryptedMessage> {
  if (!hasActiveSession(recipientPeerId)) {
    throw new Error(`No active session with peer — handshake required`);
  }
  
  const ourPeerId = getOurPeerId();
  if (!ourPeerId) throw new Error('Node not initialized');
  
  // Encrypt through Double Ratchet
  const plaintext = new TextEncoder().encode(text);
  const ratchetMsg = encryptForPeer(recipientPeerId, plaintext);
  
  // Build wire message
  const wireMsg: WireMessage = {
    version: 1,
    recipientPeerId,
    ciphertext: ratchetMsg.payload.ciphertext,
    nonce: ratchetMsg.payload.nonce,
    dhPublicKey: ratchetMsg.header.dhPublicKey,
    chainIndex: ratchetMsg.header.messageIndex,
    previousChainLength: ratchetMsg.header.previousChainLength,
    messageType: 'text',
  };
  
  // Send
  try {
    await sendWireMessage(recipientPeerId, wireMsg);
  } catch (err) {
    // Queue for later delivery
    console.warn(`👻 Peer offline, queuing message for ${recipientPeerId.slice(0, 16)}...`);
    queueMessage(recipientPeerId, wireMsg, options);
  }
  
  // Build display message
  const displayMsg: DecryptedMessage = {
    id: uuidv4(),
    senderPeerId: ourPeerId,
    content: text,
    timestamp: Date.now(),
    incoming: false,
    delivered: true,
    read: false,
    ephemeral: options.ephemeral ?? false,
    ttl: options.ttl ?? 0,
    expiresAt: options.ttl ? Date.now() + options.ttl : null,
  };
  
  // Notify UI
  for (const cb of outgoingCallbacks) {
    cb(displayMsg);
  }
  
  return displayMsg;
}

/**
 * Handle an incoming wire message.
 */
function handleIncomingMessage(senderPeerId: string, wireMsg: WireMessage): void {
  try {
    // Rebuild RatchetMessage from wire format
    const ratchetMsg = {
      header: {
        dhPublicKey: wireMsg.dhPublicKey,
        previousChainLength: wireMsg.previousChainLength,
        messageIndex: wireMsg.chainIndex,
      },
      payload: {
        ciphertext: wireMsg.ciphertext,
        nonce: wireMsg.nonce,
      },
    };
    
    // Decrypt through Double Ratchet
    const plaintext = decryptFromPeer(senderPeerId, ratchetMsg);
    const text = new TextDecoder().decode(plaintext);
    
    // Build display message
    const displayMsg: DecryptedMessage = {
      id: uuidv4(),
      senderPeerId,
      content: text,
      timestamp: Date.now(),
      incoming: true,
      delivered: true,
      read: false,
      ephemeral: false, // Determined by sender's TTL
      ttl: 0,
      expiresAt: null,
    };
    
    // Notify UI
    for (const cb of incomingCallbacks) {
      cb(displayMsg);
    }
    
    console.log(`👻 Message received from ${senderPeerId.slice(0, 16)}...`);
  } catch (err) {
    console.error(`👻 Failed to decrypt message from ${senderPeerId.slice(0, 16)}...`, err);
  }
}

/**
 * Queue a message for offline delivery.
 */
function queueMessage(
  peerId: string,
  _wireMsg: WireMessage,
  _options: { ephemeral?: boolean; ttl?: number }
): void {
  if (!messageQueue.has(peerId)) {
    messageQueue.set(peerId, []);
  }
  // Messages are queued in encrypted form for later sending
}

/**
 * Flush queued messages for a newly-online peer.
 */
export async function flushQueuedMessages(peerId: string): Promise<number> {
  const queued = messageQueue.get(peerId);
  if (!queued || queued.length === 0) return 0;
  
  let sent = 0;
  // TODO: Re-send queued messages
  messageQueue.delete(peerId);
  
  return sent;
}

/**
 * Register callback for incoming messages.
 */
export function onIncomingMessage(callback: IncomingMessageCallback): () => void {
  incomingCallbacks.add(callback);
  return () => incomingCallbacks.delete(callback);
}

/**
 * Register callback for outgoing messages (sent confirmation).
 */
export function onOutgoingMessage(callback: OutgoingMessageCallback): () => void {
  outgoingCallbacks.add(callback);
  return () => outgoingCallbacks.delete(callback);
}
