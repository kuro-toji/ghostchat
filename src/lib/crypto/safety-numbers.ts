/**
 * GhostChat — Safety Number Generation
 * 
 * Compare safety numbers in person to verify no MITM.
 * Same algorithm as Signal: hash both identity keys together.
 * 
 * Algorithm:
 *   input = sort([our_identity_key, their_identity_key])
 *   hash  = SHA256(input[0] || input[1]) iterated 5200 times
 *   number = 12 groups of 5-digit numbers (60 digits total)
 * 
 * If both sides compute the same 60 digits → no MITM.
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, concatBytes } from '@noble/hashes/utils';

/** Number of hash iterations for additional security */
const ITERATIONS = 5200;

/** Safety number result */
export interface SafetyNumber {
  /** 12 groups of 5-digit numbers */
  groups: string[];
  /** Full 60-digit string */
  fullNumber: string;
  /** Short display format */
  displayFormat: string;
}

/**
 * Generate a safety number from two identity public keys.
 * 
 * Both parties compute the same result regardless of who is "our" vs "their".
 * Keys are sorted to ensure determinism.
 * 
 * @param ourIdentityKey - Our Ed25519 public key (32 bytes)
 * @param theirIdentityKey - Their Ed25519 public key (32 bytes)
 * @returns Safety number object
 */
export function generateSafetyNumber(
  ourIdentityKey: Uint8Array,
  theirIdentityKey: Uint8Array
): SafetyNumber {
  // Sort keys so both sides compute the same result
  const sorted = sortKeys(ourIdentityKey, theirIdentityKey);
  
  // Compute fingerprint for each key
  const fp1 = computeFingerprint(sorted[0], sorted[1]);
  const fp2 = computeFingerprint(sorted[1], sorted[0]);
  
  // Combine fingerprints
  const combined = concatBytes(fp1, fp2);
  
  // Extract 12 groups of 5-digit numbers
  const groups: string[] = [];
  for (let i = 0; i < 12; i++) {
    const offset = i * 5;
    // Use 5 bytes → modulo 100000 for 5-digit number
    const value = (
      (combined[offset] << 24) |
      (combined[offset + 1] << 16) |
      (combined[offset + 2] << 8) |
      (combined[offset + 3])
    ) >>> 0;
    groups.push(String(value % 100000).padStart(5, '0'));
  }
  
  const fullNumber = groups.join('');
  const displayFormat = groups.map((g, i) => 
    (i > 0 && i % 4 === 0) ? '\n' + g : g
  ).join(' ');
  
  return { groups, fullNumber, displayFormat };
}

/**
 * Compare two safety numbers for equality.
 */
export function compareSafetyNumbers(a: SafetyNumber, b: SafetyNumber): boolean {
  return a.fullNumber === b.fullNumber;
}

/**
 * Detect if a peer's identity key has changed (key mismatch).
 * 
 * Returns:
 *   'same' — key unchanged (normal)
 *   'changed' — key changed since last verification (DANGEROUS)
 *   'new' — never seen before (expected for new contacts)
 */
export function detectKeyChange(
  currentKey: Uint8Array,
  storedKey: Uint8Array | null
): 'same' | 'changed' | 'new' {
  if (!storedKey) return 'new';
  
  if (currentKey.length !== storedKey.length) return 'changed';
  
  let same = true;
  for (let i = 0; i < currentKey.length; i++) {
    if (currentKey[i] !== storedKey[i]) {
      same = false;
      break;
    }
  }
  
  return same ? 'same' : 'changed';
}

/**
 * Generate a QR code payload from safety number.
 * Format: "ghostchat:verify:<60-digit-safety-number>"
 */
export function safetyNumberToQRPayload(safetyNumber: SafetyNumber): string {
  return `ghostchat:verify:${safetyNumber.fullNumber}`;
}

/**
 * Parse a QR code payload back to a safety number string.
 */
export function parseSafetyNumberQR(payload: string): string | null {
  const prefix = 'ghostchat:verify:';
  if (!payload.startsWith(prefix)) return null;
  const number = payload.slice(prefix.length);
  if (number.length !== 60 || !/^\d+$/.test(number)) return null;
  return number;
}

// ─── Internal ────────────────────────────────────────────────

function computeFingerprint(key: Uint8Array, otherKey: Uint8Array): Uint8Array {
  let hash = concatBytes(key, otherKey);
  for (let i = 0; i < ITERATIONS; i++) {
    hash = sha256(concatBytes(key, hash));
  }
  return hash;
}

function sortKeys(a: Uint8Array, b: Uint8Array): [Uint8Array, Uint8Array] {
  const aHex = bytesToHex(a);
  const bHex = bytesToHex(b);
  return aHex < bHex ? [a, b] : [b, a];
}
