/**
 * GhostChat — Module 2.6: Noise XX Handshake
 * 
 * Noise XX pattern: both sides authenticate each other.
 * Used once per new conversation to establish the initial shared secret.
 * After handshake completes, Double Ratchet takes over permanently.
 * 
 * Pattern:     Noise XX (mutual authentication)
 * Primitives:  X25519 + AES-256-GCM + SHA256
 * Rounds:      3 (Alice→Bob, Bob→Alice, Alice→Bob)
 * 
 * This module wraps @stablelib/noise with GhostChat-specific
 * configuration and provides a simplified API for the P2P layer.
 * 
 * Note: In Phase 3, libp2p uses its own Noise implementation for
 * transport encryption. This module is for application-level
 * handshake when establishing Double Ratchet sessions.
 */

import { generateX25519KeyPair, computeSharedSecret, type X25519KeyPair } from './key-exchange';
import { deriveKey } from './kdf';
import { encrypt, decrypt, type EncryptedPayload } from './encryption';
import { sign, verify } from './identity';
import { sha256 } from '@noble/hashes/sha256';
import { randomBytes, bytesToHex, concatBytes } from '@noble/hashes/utils';

/** Noise handshake state machine phases */
export enum HandshakePhase {
  /** Waiting to start */
  INITIALIZED = 'initialized',
  /** Waiting for response (Alice sent msg 1) */
  WAITING_FOR_RESPONSE = 'waiting_for_response',
  /** Waiting for final (Bob sent msg 2) */
  WAITING_FOR_FINAL = 'waiting_for_final',
  /** Handshake complete — Double Ratchet can begin */
  COMPLETE = 'complete',
  /** Error state */
  FAILED = 'failed',
}

/** Handshake message sent between peers */
export interface HandshakeMessage {
  /** Ephemeral public key for this round */
  ephemeralPublicKey: Uint8Array;
  /** Encrypted payload (identity proof) */
  payload: EncryptedPayload | null;
  /** Static public key (encrypted after round 1) */
  staticPublicKey: Uint8Array | null;
  /** Signature proving identity ownership */
  signature: Uint8Array | null;
}

/** Result of a completed handshake */
export interface HandshakeResult {
  /** 32-byte shared secret for Double Ratchet initialization */
  sharedSecret: Uint8Array;
  /** Peer's verified Ed25519 identity public key */
  peerIdentityKey: Uint8Array;
  /** Peer's X25519 public key for DH ratchet initialization */
  peerDHPublicKey: Uint8Array;
}

/** Noise XX handshake state */
export interface HandshakeState {
  /** Current phase */
  phase: HandshakePhase;
  /** Are we the initiator (Alice)? */
  isInitiator: boolean;
  /** Our static X25519 keypair */
  staticKeyPair: X25519KeyPair;
  /** Our ephemeral X25519 keypair (regenerated per handshake) */
  ephemeralKeyPair: X25519KeyPair;
  /** Our Ed25519 identity private key (for signing) */
  identityPrivateKey: Uint8Array;
  /** Our Ed25519 identity public key */
  identityPublicKey: Uint8Array;
  /** Peer's ephemeral public key (learned during handshake) */
  peerEphemeralPublicKey: Uint8Array | null;
  /** Peer's static public key (learned during handshake) */
  peerStaticPublicKey: Uint8Array | null;
  /** Peer's Ed25519 identity key (verified during handshake) */
  peerIdentityKey: Uint8Array | null;
  /** Chaining key — evolves through handshake rounds */
  chainingKey: Uint8Array;
  /** Handshake hash — transcript of all messages */
  handshakeHash: Uint8Array;
}

/** Protocol name for Noise XX with our primitives */
const PROTOCOL_NAME = 'Noise_XX_25519_AESGCM_SHA256';

/**
 * Initialize a Noise XX handshake.
 * 
 * @param isInitiator - true if we send the first message (Alice)
 * @param staticKeyPair - Our long-term X25519 keypair
 * @param identityPrivateKey - Our Ed25519 private key
 * @param identityPublicKey - Our Ed25519 public key
 */
export function initHandshake(
  isInitiator: boolean,
  staticKeyPair: X25519KeyPair,
  identityPrivateKey: Uint8Array,
  identityPublicKey: Uint8Array
): HandshakeState {
  const protocolBytes = new TextEncoder().encode(PROTOCOL_NAME);
  const initialHash = sha256(protocolBytes);
  
  return {
    phase: HandshakePhase.INITIALIZED,
    isInitiator,
    staticKeyPair,
    ephemeralKeyPair: generateX25519KeyPair(),
    identityPrivateKey,
    identityPublicKey,
    peerEphemeralPublicKey: null,
    peerStaticPublicKey: null,
    peerIdentityKey: null,
    chainingKey: initialHash.slice(0, 32),
    handshakeHash: initialHash,
  };
}

/**
 * Generate handshake message 1 (Alice → Bob).
 * 
 * Alice sends her ephemeral public key in the clear.
 * No encryption yet — this is the bootstrap message.
 */
export function createMessage1(state: HandshakeState): HandshakeMessage {
  if (state.phase !== HandshakePhase.INITIALIZED || !state.isInitiator) {
    throw new Error('Invalid state for message 1');
  }
  
  // Mix ephemeral key into handshake hash
  state.handshakeHash = mixHash(state.handshakeHash, state.ephemeralKeyPair.publicKey);
  state.phase = HandshakePhase.WAITING_FOR_RESPONSE;
  
  return {
    ephemeralPublicKey: state.ephemeralKeyPair.publicKey,
    payload: null,
    staticPublicKey: null,
    signature: null,
  };
}

/**
 * Process message 1 and create message 2 (Bob → Alice).
 * 
 * Bob receives Alice's ephemeral key, sends his own ephemeral + static key.
 * Bob also sends a signature proving he owns his identity key.
 */
export function processMessage1AndCreateMessage2(
  state: HandshakeState,
  msg1: HandshakeMessage
): HandshakeMessage {
  if (state.phase !== HandshakePhase.INITIALIZED || state.isInitiator) {
    throw new Error('Invalid state for processing message 1');
  }
  
  // Store Alice's ephemeral key
  state.peerEphemeralPublicKey = msg1.ephemeralPublicKey;
  
  // Mix keys into handshake hash
  state.handshakeHash = mixHash(state.handshakeHash, msg1.ephemeralPublicKey);
  state.handshakeHash = mixHash(state.handshakeHash, state.ephemeralKeyPair.publicKey);
  
  // DH: ee (both ephemeral keys)
  const dhEE = computeSharedSecret(state.ephemeralKeyPair.privateKey, msg1.ephemeralPublicKey);
  state.chainingKey = mixKey(state.chainingKey, dhEE);
  
  // DH: se (our static, their ephemeral)
  const dhSE = computeSharedSecret(state.staticKeyPair.privateKey, msg1.ephemeralPublicKey);
  state.chainingKey = mixKey(state.chainingKey, dhSE);
  
  // Encrypt our static public key
  const encKey = deriveKey(state.chainingKey, new Uint8Array(32), 'noise-enc', 32);
  const encStatic = encrypt(state.staticKeyPair.publicKey, encKey);
  state.handshakeHash = mixHash(state.handshakeHash, encStatic.ciphertext);
  
  // Sign the handshake transcript to prove identity
  const transcriptHash = sha256(state.handshakeHash);
  const sig = sign(transcriptHash, state.identityPrivateKey);
  
  // Encrypt identity proof
  const proofKey = deriveKey(state.chainingKey, new Uint8Array(32), 'noise-proof', 32);
  const identityProof = concatBytes(state.identityPublicKey, sig);
  const encProof = encrypt(identityProof, proofKey);
  
  state.phase = HandshakePhase.WAITING_FOR_FINAL;
  
  return {
    ephemeralPublicKey: state.ephemeralKeyPair.publicKey,
    payload: encProof,
    staticPublicKey: encStatic.ciphertext,
    signature: encStatic.nonce,
  };
}

/**
 * Process message 2 and create message 3 (Alice → Bob).
 * 
 * Alice receives Bob's keys and identity proof.
 * Alice verifies Bob's identity and sends her own proof.
 */
export function processMessage2AndCreateMessage3(
  state: HandshakeState,
  msg2: HandshakeMessage
): { message: HandshakeMessage; result: HandshakeResult } {
  if (state.phase !== HandshakePhase.WAITING_FOR_RESPONSE || !state.isInitiator) {
    throw new Error('Invalid state for processing message 2');
  }
  
  // Store Bob's ephemeral key
  state.peerEphemeralPublicKey = msg2.ephemeralPublicKey;
  state.handshakeHash = mixHash(state.handshakeHash, msg2.ephemeralPublicKey);
  
  // DH: ee
  const dhEE = computeSharedSecret(state.ephemeralKeyPair.privateKey, msg2.ephemeralPublicKey);
  state.chainingKey = mixKey(state.chainingKey, dhEE);
  
  // Decrypt Bob's static key
  if (!msg2.staticPublicKey || !msg2.signature) {
    throw new Error('Message 2 missing static key or nonce');
  }
  const decKey = deriveKey(state.chainingKey, new Uint8Array(32), 'noise-enc', 32);
  const bobStaticKey = decrypt(
    { ciphertext: msg2.staticPublicKey, nonce: msg2.signature },
    decKey
  );
  state.peerStaticPublicKey = bobStaticKey;
  state.handshakeHash = mixHash(state.handshakeHash, msg2.staticPublicKey);
  
  // DH: es (our ephemeral, their static)
  const dhES = computeSharedSecret(state.ephemeralKeyPair.privateKey, bobStaticKey);
  state.chainingKey = mixKey(state.chainingKey, dhES);
  
  // Decrypt and verify Bob's identity proof
  if (!msg2.payload) {
    throw new Error('Message 2 missing identity proof');
  }
  const proofKey = deriveKey(state.chainingKey, new Uint8Array(32), 'noise-proof', 32);
  const identityProof = decrypt(msg2.payload, proofKey);
  const bobIdentityKey = identityProof.slice(0, 32);
  const bobSignature = identityProof.slice(32);
  
  const transcriptHash = sha256(state.handshakeHash);
  if (!verify(transcriptHash, bobSignature, bobIdentityKey)) {
    state.phase = HandshakePhase.FAILED;
    throw new Error('HANDSHAKE FAILED: Bob identity verification failed — possible MITM');
  }
  state.peerIdentityKey = bobIdentityKey;
  
  // Now send our identity proof
  const aliceEncKey = deriveKey(state.chainingKey, new Uint8Array(32), 'noise-enc-2', 32);
  const encAliceStatic = encrypt(state.staticKeyPair.publicKey, aliceEncKey);
  
  // DH: se (our static, their ephemeral)
  const dhSE = computeSharedSecret(state.staticKeyPair.privateKey, msg2.ephemeralPublicKey);
  state.chainingKey = mixKey(state.chainingKey, dhSE);
  
  const aliceProofKey = deriveKey(state.chainingKey, new Uint8Array(32), 'noise-proof-2', 32);
  const aliceTranscript = sha256(mixHash(state.handshakeHash, encAliceStatic.ciphertext));
  const aliceSig = sign(aliceTranscript, state.identityPrivateKey);
  const aliceProof = concatBytes(state.identityPublicKey, aliceSig);
  const encAliceProof = encrypt(aliceProof, aliceProofKey);
  
  // Derive final shared secret
  const sharedSecret = deriveKey(state.chainingKey, new Uint8Array(32), 'noise-final', 32);
  
  state.phase = HandshakePhase.COMPLETE;
  
  return {
    message: {
      ephemeralPublicKey: state.ephemeralKeyPair.publicKey,
      payload: encAliceProof,
      staticPublicKey: encAliceStatic.ciphertext,
      signature: encAliceStatic.nonce,
    },
    result: {
      sharedSecret,
      peerIdentityKey: bobIdentityKey,
      peerDHPublicKey: msg2.ephemeralPublicKey,
    },
  };
}

/**
 * Process message 3 (Bob receives Alice's final message).
 * 
 * Bob verifies Alice's identity and both sides now have
 * the shared secret to initialize the Double Ratchet.
 */
export function processMessage3(
  state: HandshakeState,
  msg3: HandshakeMessage
): HandshakeResult {
  if (state.phase !== HandshakePhase.WAITING_FOR_FINAL || state.isInitiator) {
    throw new Error('Invalid state for processing message 3');
  }
  
  // Decrypt Alice's static key
  if (!msg3.staticPublicKey || !msg3.signature) {
    throw new Error('Message 3 missing static key');
  }
  const decKey = deriveKey(state.chainingKey, new Uint8Array(32), 'noise-enc-2', 32);
  const aliceStaticKey = decrypt(
    { ciphertext: msg3.staticPublicKey, nonce: msg3.signature },
    decKey
  );
  state.peerStaticPublicKey = aliceStaticKey;
  
  // DH: es (our ephemeral, their static)
  const dhES = computeSharedSecret(state.ephemeralKeyPair.privateKey, aliceStaticKey);
  state.chainingKey = mixKey(state.chainingKey, dhES);
  
  // Verify Alice's identity proof
  if (!msg3.payload) {
    throw new Error('Message 3 missing identity proof');
  }
  const proofKey = deriveKey(state.chainingKey, new Uint8Array(32), 'noise-proof-2', 32);
  const identityProof = decrypt(msg3.payload, proofKey);
  const aliceIdentityKey = identityProof.slice(0, 32);
  const aliceSignature = identityProof.slice(32);
  
  state.handshakeHash = mixHash(state.handshakeHash, msg3.staticPublicKey);
  const transcriptHash = sha256(state.handshakeHash);
  if (!verify(transcriptHash, aliceSignature, aliceIdentityKey)) {
    state.phase = HandshakePhase.FAILED;
    throw new Error('HANDSHAKE FAILED: Alice identity verification failed — possible MITM');
  }
  state.peerIdentityKey = aliceIdentityKey;
  
  // Derive final shared secret (same as Alice's)
  const sharedSecret = deriveKey(state.chainingKey, new Uint8Array(32), 'noise-final', 32);
  
  state.phase = HandshakePhase.COMPLETE;
  
  return {
    sharedSecret,
    peerIdentityKey: aliceIdentityKey,
    peerDHPublicKey: msg3.ephemeralPublicKey,
  };
}

// ─── Utility functions ───────────────────────────────────────

/** Mix data into the handshake hash (transcript). */
function mixHash(currentHash: Uint8Array, data: Uint8Array): Uint8Array {
  return sha256(concatBytes(currentHash, data));
}

/** Mix a DH output into the chaining key. */
function mixKey(chainingKey: Uint8Array, dhOutput: Uint8Array): Uint8Array {
  return deriveKey(concatBytes(chainingKey, dhOutput), new Uint8Array(32), 'noise-mix', 32);
}
