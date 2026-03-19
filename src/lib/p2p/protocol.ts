/**
 * GhostChat — Module 3.4: Protocol Handler
 * 
 * Custom GhostChat messaging protocol over libp2p streams.
 * 
 * Protocol ID:  /ghostchat/1.0/message
 * Wire format:  [4 bytes version][32 bytes recipient PeerID][n bytes ciphertext]
 * 
 * On receive:
 *   - Check recipient matches our PeerID
 *   - Double Ratchet decrypt → plaintext
 *   - If recipient mismatch: discard silently
 * 
 * Relay peers see only encrypted bytes — no keys, no plaintext.
 */

import { getNode, getOurPeerId } from './node';
import { openStream } from './connections';
import type { Stream } from '@libp2p/interface';

/** GhostChat protocol identifier */
export const GHOSTCHAT_PROTOCOL = '/ghostchat/1.0/message';

/** Protocol version */
const PROTOCOL_VERSION = 1;

/** Maximum message size (1 MB) */
const MAX_MESSAGE_SIZE = 1024 * 1024;

/** Wire message structure */
export interface WireMessage {
  /** Protocol version */
  version: number;
  /** Recipient's PeerID (32 bytes) */
  recipientPeerId: string;
  /** Encrypted ciphertext (Double Ratchet output) */
  ciphertext: Uint8Array;
  /** Nonce for AES-GCM */
  nonce: Uint8Array;
  /** Sender's current DH public key (for ratchet) */
  dhPublicKey: Uint8Array;
  /** Chain index in Double Ratchet */
  chainIndex: number;
  /** Previous chain length */
  previousChainLength: number;
  /** Message type */
  messageType: 'text' | 'key_exchange' | 'system' | 'prekey';
}

/** Incoming message callback */
type MessageCallback = (senderPeerId: string, message: WireMessage) => void;
const messageCallbacks: Set<MessageCallback> = new Set();

/**
 * Register our protocol handler.
 * 
 * Called once after node initialization.
 * Listens for incoming /ghostchat/1.0/message streams.
 */
export async function registerProtocolHandler(): Promise<void> {
  const node = getNode();
  if (!node) throw new Error('Node not initialized');
  
  await node.handle(GHOSTCHAT_PROTOCOL, async ({ stream, connection }) => {
    const senderPeerId = connection.remotePeer.toString();
    
    try {
      const data = await readStream(stream);
      const message = deserializeWireMessage(data);
      
      // Check recipient — discard silently if not for us
      const ourPeerId = getOurPeerId();
      if (message.recipientPeerId !== ourPeerId) {
        console.warn(`👻 Message not for us, discarding`);
        return;
      }
      
      // Notify registered handlers
      for (const cb of messageCallbacks) {
        cb(senderPeerId, message);
      }
    } catch (err) {
      console.error('👻 Protocol handler error:', err);
    } finally {
      try { stream.close(); } catch { /* ignore */ }
    }
  });
  
  console.log(`👻 Protocol handler registered: ${GHOSTCHAT_PROTOCOL}`);
}

/**
 * Send a wire message to a peer.
 * 
 * Opens a new protocol stream, sends the message, closes stream.
 * 
 * @param recipientPeerId - Target peer's PeerID
 * @param message - Wire message to send
 */
export async function sendWireMessage(
  recipientPeerId: string,
  message: WireMessage
): Promise<void> {
  const stream = await openStream(recipientPeerId, GHOSTCHAT_PROTOCOL);
  
  try {
    const data = serializeWireMessage(message);
    await writeStream(stream, data);
  } finally {
    try { stream.close(); } catch { /* ignore */ }
  }
}

/**
 * Register a callback for incoming messages.
 * Returns an unsubscribe function.
 */
export function onMessage(callback: MessageCallback): () => void {
  messageCallbacks.add(callback);
  return () => messageCallbacks.delete(callback);
}

// ─── Serialization ───────────────────────────────────────────

/**
 * Serialize a WireMessage to bytes.
 * 
 * Format:
 *   [4 bytes] version (uint32 BE)
 *   [4 bytes] recipientPeerId length
 *   [n bytes] recipientPeerId (UTF-8)
 *   [4 bytes] ciphertext length
 *   [n bytes] ciphertext
 *   [12 bytes] nonce
 *   [32 bytes] dhPublicKey
 *   [4 bytes] chainIndex (uint32 BE)
 *   [4 bytes] previousChainLength (uint32 BE)
 *   [1 byte]  messageType (0=text, 1=key_exchange, 2=system, 3=prekey)
 */
function serializeWireMessage(msg: WireMessage): Uint8Array {
  const recipientBytes = new TextEncoder().encode(msg.recipientPeerId);
  
  const totalSize = 4 + 4 + recipientBytes.length + 4 + msg.ciphertext.length + 12 + 32 + 4 + 4 + 1;
  const buf = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer);
  let offset = 0;
  
  // Version
  view.setUint32(offset, msg.version, false);
  offset += 4;
  
  // Recipient PeerID
  view.setUint32(offset, recipientBytes.length, false);
  offset += 4;
  buf.set(recipientBytes, offset);
  offset += recipientBytes.length;
  
  // Ciphertext
  view.setUint32(offset, msg.ciphertext.length, false);
  offset += 4;
  buf.set(msg.ciphertext, offset);
  offset += msg.ciphertext.length;
  
  // Nonce (12 bytes)
  buf.set(msg.nonce, offset);
  offset += 12;
  
  // DH public key (32 bytes)
  buf.set(msg.dhPublicKey, offset);
  offset += 32;
  
  // Chain index
  view.setUint32(offset, msg.chainIndex, false);
  offset += 4;
  
  // Previous chain length
  view.setUint32(offset, msg.previousChainLength, false);
  offset += 4;
  
  // Message type
  const typeMap = { text: 0, key_exchange: 1, system: 2, prekey: 3 };
  buf[offset] = typeMap[msg.messageType] ?? 0;
  
  return buf;
}

/**
 * Deserialize bytes to WireMessage.
 */
function deserializeWireMessage(data: Uint8Array): WireMessage {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  
  // Version
  const version = view.getUint32(offset, false);
  offset += 4;
  
  // Recipient PeerID
  const recipientLen = view.getUint32(offset, false);
  offset += 4;
  const recipientPeerId = new TextDecoder().decode(data.slice(offset, offset + recipientLen));
  offset += recipientLen;
  
  // Ciphertext
  const ciphertextLen = view.getUint32(offset, false);
  offset += 4;
  const ciphertext = data.slice(offset, offset + ciphertextLen);
  offset += ciphertextLen;
  
  // Nonce
  const nonce = data.slice(offset, offset + 12);
  offset += 12;
  
  // DH public key
  const dhPublicKey = data.slice(offset, offset + 32);
  offset += 32;
  
  // Chain index
  const chainIndex = view.getUint32(offset, false);
  offset += 4;
  
  // Previous chain length
  const previousChainLength = view.getUint32(offset, false);
  offset += 4;
  
  // Message type
  const typeReverseMap: Record<number, WireMessage['messageType']> = {
    0: 'text', 1: 'key_exchange', 2: 'system', 3: 'prekey',
  };
  const messageType = typeReverseMap[data[offset]] ?? 'text';
  
  return {
    version,
    recipientPeerId,
    ciphertext,
    nonce,
    dhPublicKey,
    chainIndex,
    previousChainLength,
    messageType,
  };
}

// ─── Stream I/O ──────────────────────────────────────────────

async function readStream(stream: Stream): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalSize = 0;
  
  for await (const chunk of stream.source) {
    const data = chunk.subarray();
    totalSize += data.length;
    
    if (totalSize > MAX_MESSAGE_SIZE) {
      throw new Error('Message too large');
    }
    
    chunks.push(data);
  }
  
  // Concatenate chunks
  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  
  return result;
}

async function writeStream(stream: Stream, data: Uint8Array): Promise<void> {
  const writer = stream.sink;
  await writer([data]);
}
