/**
 * GhostChat — Module 2.1: Identity
 * 
 * Ed25519 key generation, signing, and verification.
 * Your Ed25519 public key IS your GhostChat address.
 * Private key never leaves the device.
 * 
 * Algorithm:  Ed25519 (RFC 8032)
 * Library:    @noble/curves/ed25519
 * Keys:       32 bytes private, 32 bytes public
 * Recovery:   BIP39-style 12-word mnemonic (future)
 */

import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

/** Ed25519 identity keypair */
export interface IdentityKeyPair {
  /** 32-byte private key — NEVER leaves device */
  privateKey: Uint8Array;
  /** 32-byte public key — your GhostChat address */
  publicKey: Uint8Array;
}

/** Signed message envelope */
export interface SignedMessage {
  /** Original message bytes */
  message: Uint8Array;
  /** 64-byte Ed25519 signature */
  signature: Uint8Array;
  /** Signer's public key */
  signerPublicKey: Uint8Array;
}

/**
 * Generate a new Ed25519 identity keypair.
 * Uses cryptographically secure random bytes.
 */
export function generateIdentity(): IdentityKeyPair {
  const privateKey = ed25519.utils.randomPrivateKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

/**
 * Derive public key from an existing private key.
 */
export function getPublicKey(privateKey: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(privateKey);
}

/**
 * Sign a message with the identity private key.
 * Every outbound message is signed to prove authenticity.
 */
export function sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array {
  return ed25519.sign(message, privateKey);
}

/**
 * Verify a signature against a message and public key.
 * Every inbound message is verified before processing.
 * Returns true if authentic, false if tampered or forged.
 */
export function verify(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): boolean {
  try {
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}

/**
 * Create a signed message envelope.
 */
export function signMessage(
  message: Uint8Array,
  privateKey: Uint8Array
): SignedMessage {
  const publicKey = getPublicKey(privateKey);
  const signature = sign(message, privateKey);
  return { message, signature, signerPublicKey: publicKey };
}

/**
 * Verify and extract a signed message.
 * Returns null if verification fails (tampered or forged).
 */
export function verifyMessage(signed: SignedMessage): Uint8Array | null {
  const valid = verify(signed.message, signed.signature, signed.signerPublicKey);
  return valid ? signed.message : null;
}

/**
 * Generate a fingerprint from a public key.
 * Used for display in UI (first 6 hex chars).
 */
export function fingerprint(publicKey: Uint8Array): string {
  const hash = sha256(publicKey);
  return bytesToHex(hash).slice(0, 12); // 6 bytes = 12 hex chars
}

/**
 * Serialize a public key to hex string for transport/display.
 */
export function publicKeyToHex(publicKey: Uint8Array): string {
  return bytesToHex(publicKey);
}

/**
 * Deserialize a hex string back to public key bytes.
 */
export function hexToPublicKey(hex: string): Uint8Array {
  return hexToBytes(hex);
}

/**
 * Serialize a private key to hex (for encrypted storage only).
 * WARNING: Handle with extreme care — this is the master secret.
 */
export function privateKeyToHex(privateKey: Uint8Array): string {
  return bytesToHex(privateKey);
}

/**
 * Deserialize hex to private key bytes.
 */
export function hexToPrivateKey(hex: string): Uint8Array {
  return hexToBytes(hex);
}
