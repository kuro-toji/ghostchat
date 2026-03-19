/**
 * GhostChat — Module 2.5: Double Ratchet
 * 
 * Custom lightweight Double Ratchet implementation (~20KB vs libsignal ~500KB).
 * Provides forward secrecy and break-in recovery.
 * 
 * Two ratchets:
 *   Symmetric ratchet: ChainKey → HKDF → MessageKey + NextChainKey
 *     Every message gets a unique key, old keys deleted immediately.
 *   
 *   DH ratchet: Triggered on receiving new X25519 pubkey from peer.
 *     New X25519 keypair generated, new shared secret → new root/chain keys.
 *     Breaks the chain — past chains unrelated to future chains.
 * 
 * Forward secrecy:    Key N compromised → only message N exposed
 * Break-in recovery:  DH ratchet step → future messages safe again
 * 
 * Dependencies: @noble/curves + @noble/hashes only
 */

import { generateX25519KeyPair, computeSharedSecret, type X25519KeyPair } from './key-exchange';
import { kdfRatchet, kdfChain } from './kdf';
import { encrypt, decrypt, wipeKey, type EncryptedPayload } from './encryption';
import { bytesToHex } from '@noble/hashes/utils';

/**
 * Maximum skipped message keys to store.
 * 
 * TRADEOFF:
 *   - Too low → out-of-order messages beyond this count are UNRECOVERABLE
 *   - Too high → memory exhaustion if attacker sends messages with huge index gaps
 * 
 * 100 is conservative. Signal uses ~2000. In practice, real sessions rarely
 * skip more than ~5 messages. The only scenario hitting this is:
 *   1. Peer sends 100+ messages while we're offline
 *   2. We receive them all at once in random order
 *   3. The 101st out-of-order message fails to decrypt
 * 
 * If this happens, the DH ratchet step on the NEXT message from the peer
 * creates a fresh chain — they can keep chatting, only the skipped message
 * is permanently lost.
 * 
 * If you need higher throughput, increase this. Each stored key is 32 bytes
 * + overhead, so 100 keys ≈ 5KB, 2000 keys ≈ 100KB.
 */
const MAX_SKIPPED_KEYS = 100;

/** TTL for skipped keys in milliseconds (24 hours) */
const SKIPPED_KEY_TTL = 24 * 60 * 60 * 1000;

/** Double Ratchet session state */
export interface RatchetState {
  /** Current root key (32 bytes) */
  rootKey: Uint8Array;
  /** Sending chain key (32 bytes) */
  sendingChainKey: Uint8Array;
  /** Receiving chain key (32 bytes) */
  receivingChainKey: Uint8Array;
  /** Our current X25519 DH keypair */
  ourDHKeyPair: X25519KeyPair;
  /** Their current X25519 DH public key */
  theirDHPublicKey: Uint8Array;
  /** Sending message index (counter) */
  sendingIndex: number;
  /** Receiving message index (counter) */
  receivingIndex: number;
  /** Previous sending chain length (for header) */
  previousChainLength: number;
  /** Skipped message keys for out-of-order delivery */
  skippedKeys: Map<string, SkippedKey>;
}

/** A stored skipped message key with expiry */
interface SkippedKey {
  key: Uint8Array;
  timestamp: number;
}

/** Message header — sent alongside ciphertext */
export interface MessageHeader {
  /** Sender's current DH public key */
  dhPublicKey: Uint8Array;
  /** Previous sending chain length */
  previousChainLength: number;
  /** Message index in current chain */
  messageIndex: number;
}

/** Complete encrypted message from Double Ratchet */
export interface RatchetMessage {
  header: MessageHeader;
  payload: EncryptedPayload;
}

/**
 * Initialize a Double Ratchet session as Alice (initiator).
 * 
 * Called after X3DH or Noise handshake establishes the shared secret.
 * Alice sends first, so she does the initial DH ratchet step.
 * 
 * @param sharedSecret - 32-byte secret from X3DH or Noise
 * @param bobPublicKey - Bob's X25519 public key
 */
export function initializeAlice(
  sharedSecret: Uint8Array,
  bobPublicKey: Uint8Array
): RatchetState {
  const ourDHKeyPair = generateX25519KeyPair();
  const dhOutput = computeSharedSecret(ourDHKeyPair.privateKey, bobPublicKey);
  const { newRootKey, chainKey } = kdfRatchet(sharedSecret, dhOutput);
  
  return {
    rootKey: newRootKey,
    sendingChainKey: chainKey,
    receivingChainKey: new Uint8Array(32), // set on first receive
    ourDHKeyPair,
    theirDHPublicKey: bobPublicKey,
    sendingIndex: 0,
    receivingIndex: 0,
    previousChainLength: 0,
    skippedKeys: new Map(),
  };
}

/**
 * Initialize a Double Ratchet session as Bob (responder).
 * 
 * Bob waits to receive Alice's first message before completing setup.
 * 
 * @param sharedSecret - 32-byte secret from X3DH or Noise
 * @param ourDHKeyPair - Bob's X25519 keypair (used in handshake)
 */
export function initializeBob(
  sharedSecret: Uint8Array,
  ourDHKeyPair: X25519KeyPair
): RatchetState {
  return {
    rootKey: sharedSecret,
    sendingChainKey: new Uint8Array(32),
    receivingChainKey: new Uint8Array(32),
    ourDHKeyPair,
    theirDHPublicKey: new Uint8Array(32), // set on first receive
    sendingIndex: 0,
    receivingIndex: 0,
    previousChainLength: 0,
    skippedKeys: new Map(),
  };
}

/**
 * Encrypt a message using the Double Ratchet.
 * 
 * Advances the symmetric sending ratchet:
 *   sendingChainKey → HKDF → messageKey + nextChainKey
 *   messageKey used once then deleted
 * 
 * @param state - Current ratchet state (mutated in place)
 * @param plaintext - Data to encrypt
 * @returns Encrypted message with header
 */
export function ratchetEncrypt(
  state: RatchetState,
  plaintext: Uint8Array
): RatchetMessage {
  // Symmetric ratchet step — derive message key
  const { messageKey, nextChainKey } = kdfChain(state.sendingChainKey);
  
  // Update state
  state.sendingChainKey = nextChainKey;
  const messageIndex = state.sendingIndex;
  state.sendingIndex++;
  
  // Build header
  const header: MessageHeader = {
    dhPublicKey: state.ourDHKeyPair.publicKey,
    previousChainLength: state.previousChainLength,
    messageIndex,
  };
  
  // Encrypt with derived message key
  const headerBytes = serializeHeader(header);
  const payload = encrypt(plaintext, messageKey, headerBytes);
  
  // Wipe message key immediately — forward secrecy
  wipeKey(messageKey);
  
  return { header, payload };
}

/**
 * Decrypt a message using the Double Ratchet.
 * 
 * If the sender's DH key changed → DH ratchet step first.
 * Then symmetric ratchet to get the message key.
 * Handles out-of-order messages via skipped keys.
 * 
 * @param state - Current ratchet state (mutated in place)
 * @param message - Received encrypted message
 * @returns Decrypted plaintext
 */
export function ratchetDecrypt(
  state: RatchetState,
  message: RatchetMessage
): Uint8Array {
  // 1. Check skipped keys first (out-of-order delivery)
  const skippedResult = trySkippedKeys(state, message);
  if (skippedResult !== null) {
    return skippedResult;
  }
  
  // 2. Check if DH ratchet step needed (new DH key from sender)
  const theirDHHex = bytesToHex(message.header.dhPublicKey);
  const currentTheirDHHex = bytesToHex(state.theirDHPublicKey);
  
  if (theirDHHex !== currentTheirDHHex) {
    // Store any skipped keys from previous chain
    skipMessageKeys(state, message.header.previousChainLength);
    
    // DH ratchet step
    dhRatchetStep(state, message.header.dhPublicKey);
  }
  
  // 3. Skip message keys if index is ahead (gaps in delivery)
  skipMessageKeys(state, message.header.messageIndex);
  
  // 4. Symmetric ratchet — derive this message's key
  const { messageKey, nextChainKey } = kdfChain(state.receivingChainKey);
  state.receivingChainKey = nextChainKey;
  state.receivingIndex++;
  
  // 5. Decrypt
  const headerBytes = serializeHeader(message.header);
  const plaintext = decrypt(message.payload, messageKey, headerBytes);
  
  // Wipe message key
  wipeKey(messageKey);
  
  // 6. Clean expired skipped keys
  cleanExpiredSkippedKeys(state);
  
  return plaintext;
}

/**
 * Perform a DH ratchet step.
 * 
 * Triggered when we receive a new DH public key from the peer.
 * Generates new keypair and derives new root + chain keys.
 * This is what provides break-in recovery.
 */
function dhRatchetStep(state: RatchetState, theirNewPublicKey: Uint8Array): void {
  state.theirDHPublicKey = theirNewPublicKey;
  
  // Derive new receiving chain from their new key + our current key
  const dhRecv = computeSharedSecret(state.ourDHKeyPair.privateKey, theirNewPublicKey);
  const recvResult = kdfRatchet(state.rootKey, dhRecv);
  state.rootKey = recvResult.newRootKey;
  state.receivingChainKey = recvResult.chainKey;
  
  // Generate our new DH keypair
  state.previousChainLength = state.sendingIndex;
  state.sendingIndex = 0;
  state.receivingIndex = 0;
  state.ourDHKeyPair = generateX25519KeyPair();
  
  // Derive new sending chain from our new key + their new key
  const dhSend = computeSharedSecret(state.ourDHKeyPair.privateKey, theirNewPublicKey);
  const sendResult = kdfRatchet(state.rootKey, dhSend);
  state.rootKey = sendResult.newRootKey;
  state.sendingChainKey = sendResult.chainKey;
}

/**
 * Try decrypting with skipped keys (handles out-of-order messages).
 */
function trySkippedKeys(state: RatchetState, message: RatchetMessage): Uint8Array | null {
  const keyId = makeSkippedKeyId(message.header.dhPublicKey, message.header.messageIndex);
  const skipped = state.skippedKeys.get(keyId);
  
  if (!skipped) return null;
  
  // Remove the key — one-time use
  state.skippedKeys.delete(keyId);
  
  const headerBytes = serializeHeader(message.header);
  const plaintext = decrypt(message.payload, skipped.key, headerBytes);
  wipeKey(skipped.key);
  
  return plaintext;
}

/**
 * Store message keys for messages we haven't received yet.
 * Allows handling of out-of-order delivery.
 */
function skipMessageKeys(state: RatchetState, untilIndex: number): void {
  if (state.receivingIndex + MAX_SKIPPED_KEYS < untilIndex) {
    throw new Error('Too many skipped messages — possible attack');
  }
  
  while (state.receivingIndex < untilIndex) {
    const { messageKey, nextChainKey } = kdfChain(state.receivingChainKey);
    state.receivingChainKey = nextChainKey;
    
    const keyId = makeSkippedKeyId(state.theirDHPublicKey, state.receivingIndex);
    state.skippedKeys.set(keyId, {
      key: messageKey,
      timestamp: Date.now(),
    });
    
    state.receivingIndex++;
    
    // Enforce cap
    if (state.skippedKeys.size > MAX_SKIPPED_KEYS) {
      evictOldestSkippedKey(state);
    }
  }
}

/**
 * Remove expired skipped keys (>24h old).
 */
function cleanExpiredSkippedKeys(state: RatchetState): void {
  const now = Date.now();
  for (const [keyId, skipped] of state.skippedKeys) {
    if (now - skipped.timestamp > SKIPPED_KEY_TTL) {
      wipeKey(skipped.key);
      state.skippedKeys.delete(keyId);
    }
  }
}

/**
 * Evict the oldest skipped key when cap is reached.
 */
function evictOldestSkippedKey(state: RatchetState): void {
  let oldestId = '';
  let oldestTime = Infinity;
  
  for (const [keyId, skipped] of state.skippedKeys) {
    if (skipped.timestamp < oldestTime) {
      oldestTime = skipped.timestamp;
      oldestId = keyId;
    }
  }
  
  if (oldestId) {
    const skipped = state.skippedKeys.get(oldestId);
    if (skipped) wipeKey(skipped.key);
    state.skippedKeys.delete(oldestId);
  }
}

/**
 * Create a unique ID for a skipped key.
 */
function makeSkippedKeyId(dhPublicKey: Uint8Array, index: number): string {
  return `${index}:${bytesToHex(dhPublicKey)}`;
}

/**
 * Serialize a message header as bytes (used as AAD).
 */
function serializeHeader(header: MessageHeader): Uint8Array {
  const dhKey = header.dhPublicKey;
  const buf = new Uint8Array(32 + 4 + 4);
  buf.set(dhKey, 0);
  const view = new DataView(buf.buffer);
  view.setUint32(32, header.previousChainLength, false);
  view.setUint32(36, header.messageIndex, false);
  return buf;
}

/**
 * Get the size of skipped keys map (for monitoring).
 */
export function getSkippedKeyCount(state: RatchetState): number {
  return state.skippedKeys.size;
}
