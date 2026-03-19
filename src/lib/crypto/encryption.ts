/**
 * GhostChat — Module 2.4: Symmetric Encryption
 * 
 * AES-256-GCM authenticated encryption.
 * Every message encrypted with a unique key from the Double Ratchet.
 * 
 * Algorithm:  AES-256-GCM
 * Library:    @noble/ciphers/aes
 * Key:        256-bit (from HKDF)
 * Nonce:      12 bytes random per message — NEVER reused
 * Auth tag:   16 bytes appended (GCM = encryption + integrity)
 * Tamper:     any bit flip → decryption fails completely
 * 
 * Never used:
 *   AES-CBC — no built-in authentication
 *   AES-ECB — deterministic, leaks patterns
 */

import { gcm } from '@noble/ciphers/aes';
import { randomBytes, bytesToHex } from '@noble/hashes/utils';

/** Nonce size for AES-256-GCM (12 bytes = 96 bits) */
const NONCE_SIZE = 12;

/** Encrypted message envelope */
export interface EncryptedPayload {
  /** Ciphertext with appended 16-byte GCM auth tag */
  ciphertext: Uint8Array;
  /** 12-byte nonce (unique per message) */
  nonce: Uint8Array;
}

/** Set to track used nonces — prevents catastrophic reuse */
const usedNonces = new Set<string>();

/** Max nonces to track before clearing old ones */
const MAX_NONCE_HISTORY = 10000;

/**
 * Encrypt plaintext with AES-256-GCM.
 * 
 * Generates a fresh 12-byte random nonce per call.
 * Nonce reuse is prevented by tracking used nonces.
 * 
 * @param plaintext - Data to encrypt
 * @param key - 32-byte AES-256 key (from HKDF/Double Ratchet)
 * @param associatedData - Optional AAD for additional authentication
 * @returns Encrypted payload with ciphertext + nonce
 * @throws If key is wrong size or nonce collision detected
 */
export function encrypt(
  plaintext: Uint8Array,
  key: Uint8Array,
  associatedData?: Uint8Array
): EncryptedPayload {
  if (key.length !== 32) {
    throw new Error('AES-256-GCM requires a 32-byte key');
  }
  
  // Generate unique nonce
  const nonce = randomBytes(NONCE_SIZE);
  
  // Check for nonce reuse (should be astronomically rare with random nonces)
  const nonceHex = bytesToHex(nonce);
  if (usedNonces.has(nonceHex)) {
    throw new Error('CRITICAL: Nonce reuse detected — aborting encryption');
  }
  
  // Track nonce
  usedNonces.add(nonceHex);
  if (usedNonces.size > MAX_NONCE_HISTORY) {
    // Clear oldest half to prevent memory growth
    const entries = Array.from(usedNonces);
    for (let i = 0; i < entries.length / 2; i++) {
      usedNonces.delete(entries[i]);
    }
  }
  
  // Encrypt with AES-256-GCM
  const aes = gcm(key, nonce, associatedData);
  const ciphertext = aes.encrypt(plaintext);
  
  return { ciphertext, nonce };
}

/**
 * Decrypt ciphertext with AES-256-GCM.
 * 
 * Verifies the 16-byte authentication tag automatically.
 * Any tampering with ciphertext, nonce, or AAD → throws.
 * 
 * @param payload - Encrypted payload (ciphertext + nonce)
 * @param key - 32-byte AES-256 key (same key used for encryption)
 * @param associatedData - Optional AAD (must match encryption AAD)
 * @returns Decrypted plaintext
 * @throws If key wrong, data tampered, or auth tag mismatch
 */
export function decrypt(
  payload: EncryptedPayload,
  key: Uint8Array,
  associatedData?: Uint8Array
): Uint8Array {
  if (key.length !== 32) {
    throw new Error('AES-256-GCM requires a 32-byte key');
  }
  
  const aes = gcm(key, payload.nonce, associatedData);
  return aes.decrypt(payload.ciphertext);
}

/**
 * Encrypt a UTF-8 string message.
 * Convenience wrapper for text messages.
 */
export function encryptText(
  text: string,
  key: Uint8Array,
  associatedData?: Uint8Array
): EncryptedPayload {
  const plaintext = new TextEncoder().encode(text);
  return encrypt(plaintext, key, associatedData);
}

/**
 * Decrypt to a UTF-8 string message.
 * Convenience wrapper for text messages.
 */
export function decryptText(
  payload: EncryptedPayload,
  key: Uint8Array,
  associatedData?: Uint8Array
): string {
  const plaintext = decrypt(payload, key, associatedData);
  return new TextDecoder().decode(plaintext);
}

/**
 * Securely wipe a key from memory.
 * Overwrites the buffer with zeros.
 * Note: JS GC may still have copies — best effort only.
 */
export function wipeKey(key: Uint8Array): void {
  key.fill(0);
}
