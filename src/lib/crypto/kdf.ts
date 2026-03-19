/**
 * GhostChat — Module 2.3: Key Derivation
 * 
 * HKDF-SHA256 for deriving encryption keys from raw shared secrets.
 * Converts X25519 output into proper AES-256 keys.
 * 
 * Algorithm:  HKDF-SHA256 (RFC 5869)
 * Library:    @noble/hashes/hkdf + sha256
 * Input:      32-byte raw X25519 shared secret
 * Salt:       32 bytes random per session
 * Info:       context binding string
 * Output:     variable length, typically 64 bytes (2x 32-byte keys)
 */

import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { randomBytes } from '@noble/hashes/utils';

/** Default context string for message key derivation */
const DEFAULT_INFO = 'ghostchat-v1-msg';

/** Result of key derivation — split into encryption + MAC keys */
export interface DerivedKeys {
  /** 32-byte AES-256 encryption key */
  encryptionKey: Uint8Array;
  /** 32-byte MAC / integrity key (backup integrity check) */
  macKey: Uint8Array;
  /** 32-byte salt used (needed for reproducibility) */
  salt: Uint8Array;
}

/**
 * Derive encryption keys from a raw shared secret.
 * 
 * Produces 64 bytes split into:
 *   key[0..32] = AES-256 encryption key
 *   key[32..64] = MAC key (integrity backup)
 * 
 * @param sharedSecret - Raw 32-byte X25519 output
 * @param salt - Optional 32-byte salt (random generated if omitted)
 * @param info - Optional context string (defaults to "ghostchat-v1-msg")
 */
export function deriveKeys(
  sharedSecret: Uint8Array,
  salt?: Uint8Array,
  info?: string
): DerivedKeys {
  const useSalt = salt ?? generateSalt();
  const infoBytes = new TextEncoder().encode(info ?? DEFAULT_INFO);
  
  const derived = hkdf(sha256, sharedSecret, useSalt, infoBytes, 64);
  
  return {
    encryptionKey: derived.slice(0, 32),
    macKey: derived.slice(32, 64),
    salt: useSalt,
  };
}

/**
 * Derive a single key of specified length.
 * Used internally by Double Ratchet for chain key advancement.
 * 
 * @param input - Input key material
 * @param salt - Salt bytes
 * @param info - Context string
 * @param length - Output length in bytes (default 32)
 */
export function deriveKey(
  input: Uint8Array,
  salt: Uint8Array,
  info: string,
  length: number = 32
): Uint8Array {
  const infoBytes = new TextEncoder().encode(info);
  return hkdf(sha256, input, salt, infoBytes, length);
}

/**
 * Derive root key and chain key from DH output (Double Ratchet KDF).
 * 
 * Used when the DH ratchet advances:
 *   input = X25519(our_new_private, their_new_public)
 *   rootKey = current root key (used as salt)
 *   output = new root key + new chain key
 */
export function kdfRatchet(
  rootKey: Uint8Array,
  dhOutput: Uint8Array
): { newRootKey: Uint8Array; chainKey: Uint8Array } {
  const infoBytes = new TextEncoder().encode('ghostchat-v1-ratchet');
  const derived = hkdf(sha256, dhOutput, rootKey, infoBytes, 64);
  
  return {
    newRootKey: derived.slice(0, 32),
    chainKey: derived.slice(32, 64),
  };
}

/**
 * Derive message key from chain key (symmetric ratchet step).
 * 
 * ChainKey → HKDF → MessageKey + NextChainKey
 * Old chain key is deleted after this call.
 */
export function kdfChain(
  chainKey: Uint8Array
): { messageKey: Uint8Array; nextChainKey: Uint8Array } {
  const msgInfo = new TextEncoder().encode('ghostchat-v1-msgkey');
  const chainInfo = new TextEncoder().encode('ghostchat-v1-chainkey');
  const emptySalt = new Uint8Array(32);
  
  const messageKey = hkdf(sha256, chainKey, emptySalt, msgInfo, 32);
  const nextChainKey = hkdf(sha256, chainKey, emptySalt, chainInfo, 32);
  
  return { messageKey, nextChainKey };
}

/**
 * Generate a random 32-byte salt.
 */
export function generateSalt(): Uint8Array {
  return randomBytes(32);
}

/**
 * X3DH key derivation — for offline pre-key bundles.
 * Combines multiple DH outputs into a single shared secret.
 * 
 * @param dhResults - Array of DH outputs (DH1, DH2, DH3, optionally DH4)
 */
export function kdfX3DH(dhResults: Uint8Array[]): Uint8Array {
  // Concatenate all DH outputs
  const totalLen = dhResults.reduce((sum, dh) => sum + dh.length, 0);
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const dh of dhResults) {
    combined.set(dh, offset);
    offset += dh.length;
  }
  
  const salt = new Uint8Array(32); // zeros for X3DH
  const info = new TextEncoder().encode('ghostchat-x3dh-v1');
  
  return hkdf(sha256, combined, salt, info, 32);
}
