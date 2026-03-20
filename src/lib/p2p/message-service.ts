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
import type { DecryptedMessage } from '../../types';
import {
  initHandshake,
  createMessage1,
  processMessage1AndCreateMessage2,
  processMessage2AndCreateMessage3,
  processMessage3,
  HandshakePhase,
  type HandshakeState,
  type HandshakeMessage,
} from '../crypto/noise';
import { generateX25519KeyPair } from '../crypto/key-exchange';
import type { IdentityKeyPair } from '../crypto/identity';
import { initSessionAsAlice, initSessionAsBob } from './session-manager';

/** Incoming message callback */
type IncomingMessageCallback = (message: DecryptedMessage) => void;
const incomingCallbacks: Set<IncomingMessageCallback> = new Set();

/** Outgoing message callback (for UI confirmation) */
type OutgoingMessageCallback = (message: DecryptedMessage) => void;
const outgoingCallbacks: Set<OutgoingMessageCallback> = new Set();

/** Message queue for peers that are offline */
const messageQueue = new Map<string, WireMessage[]>();

/** Pending handshakes for Noise XX */
const pendingHandshakes = new Map<string, HandshakeState>();

/** Our identity keypair for handshakes */
let ourIdentity: IdentityKeyPair | null = null;

export function setOurIdentity(identity: IdentityKeyPair): void {
  ourIdentity = identity;
}

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
    if (wireMsg.messageType === 'key_exchange') {
      return handleHandshakeMessage(senderPeerId, wireMsg);
    }
    
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
  wireMsg: WireMessage,
  _options: { ephemeral?: boolean; ttl?: number }
): void {
  if (!messageQueue.has(peerId)) {
    messageQueue.set(peerId, []);
  }
  messageQueue.get(peerId)!.push(wireMsg);
}

/**
 * Flush queued messages for a newly-online peer.
 */
export async function flushQueuedMessages(peerId: string): Promise<number> {
  const queued = messageQueue.get(peerId);
  if (!queued || queued.length === 0) return 0;
  
  let sent = 0;
  for (const wireMsg of queued) {
    try {
      await sendWireMessage(peerId, wireMsg);
      sent++;
    } catch (err) {
      console.error(`👻 Failed to re-send queued message to ${peerId.slice(0, 16)}`, err);
    }
  }
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

// ─── Handshake Implementation ────────────────────────────────

export async function sendHandshakeInitiation(
  peerId: string,
  identityPrivateKey: Uint8Array,
  identityPublicKey: Uint8Array
): Promise<void> {
  if (hasActiveSession(peerId)) return;

  const staticKeyPair = generateX25519KeyPair();
  const state = initHandshake(true, staticKeyPair, identityPrivateKey, identityPublicKey);
  const msg1 = createMessage1(state);

  pendingHandshakes.set(peerId, state);
  await sendHandshakeWireMessage(peerId, msg1);
  console.log(`👻 Sent Noise Message 1 to ${peerId.slice(0, 16)}...`);
}

function handleHandshakeMessage(senderPeerId: string, wireMsg: WireMessage): void {
  try {
    const jsonStr = new TextDecoder().decode(wireMsg.ciphertext);
    const parsed = JSON.parse(jsonStr);
    
    const msg: HandshakeMessage = {
      ephemeralPublicKey: new Uint8Array(parsed.e),
      payload: parsed.p ? { ciphertext: new Uint8Array(parsed.p.c), nonce: new Uint8Array(parsed.p.n) } : null,
      staticPublicKey: parsed.s ? new Uint8Array(parsed.s) : null,
      signature: parsed.sig ? new Uint8Array(parsed.sig) : null,
    };

    let state = pendingHandshakes.get(senderPeerId);

    if (!state) {
      if (parsed.p == null && parsed.s == null) {
        // Message 1 (Bob receiving)
        console.log(`👻 Received Noise Message 1 from ${senderPeerId.slice(0, 16)}...`);
        if (!ourIdentity) throw new Error('Cannot process handshake without identity');
        
        const staticKeyPair = generateX25519KeyPair();
        state = initHandshake(false, staticKeyPair, ourIdentity.privateKey, ourIdentity.publicKey);
        const msg2 = processMessage1AndCreateMessage2(state, msg);
        
        pendingHandshakes.set(senderPeerId, state);
        sendHandshakeWireMessage(senderPeerId, msg2).catch(console.error);
        console.log(`👻 Sent Noise Message 2 to ${senderPeerId.slice(0, 16)}...`);
      } else {
        throw new Error('Received unexpected Handshake message without active state');
      }
    } else {
      // Continuing handshake
      if (state.phase === HandshakePhase.WAITING_FOR_RESPONSE) {
        // Message 2 (Alice receiving)
        console.log(`👻 Received Noise Message 2 from ${senderPeerId.slice(0, 16)}...`);
        const { message: msg3, result } = processMessage2AndCreateMessage3(state, msg);
        sendHandshakeWireMessage(senderPeerId, msg3).catch(console.error);
        
        initSessionAsAlice(senderPeerId, result.sharedSecret, result.peerDHPublicKey);
        pendingHandshakes.delete(senderPeerId);
        console.log(`👻 Double Ratchet initialized as Alice!`);
      } else if (state.phase === HandshakePhase.WAITING_FOR_FINAL) {
        // Message 3 (Bob receiving)
        console.log(`👻 Received Noise Message 3 from ${senderPeerId.slice(0, 16)}...`);
        const result = processMessage3(state, msg);
        
        initSessionAsBob(senderPeerId, result.sharedSecret);
        pendingHandshakes.delete(senderPeerId);
        console.log(`👻 Double Ratchet initialized as Bob!`);
      }
    }
  } catch (err) {
    console.error(`👻 Handshake error with ${senderPeerId.slice(0, 16)}...`, err);
    pendingHandshakes.delete(senderPeerId);
  }
}

async function sendHandshakeWireMessage(peerId: string, msg: HandshakeMessage): Promise<void> {
  const payloadStr = JSON.stringify({
    e: Array.from(msg.ephemeralPublicKey),
    p: msg.payload ? { c: Array.from(msg.payload.ciphertext), n: Array.from(msg.payload.nonce) } : null,
    s: msg.staticPublicKey ? Array.from(msg.staticPublicKey) : null,
    sig: msg.signature ? Array.from(msg.signature) : null,
  });
  
  const wireMsg: WireMessage = {
    version: 1,
    recipientPeerId: peerId,
    ciphertext: new TextEncoder().encode(payloadStr),
    nonce: new Uint8Array(12),
    dhPublicKey: new Uint8Array(32),
    chainIndex: 0,
    previousChainLength: 0,
    messageType: 'key_exchange',
  };
  
  await sendWireMessage(peerId, wireMsg);
}
