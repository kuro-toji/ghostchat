/**
 * GhostChat — Module 2.2: Key Exchange
 * 
 * X25519 Elliptic Curve Diffie-Hellman for shared secret derivation.
 * Both sides compute the same shared secret without transmitting it.
 * 
 * Algorithm:  X25519 ECDH (RFC 7748)
 * Library:    @noble/curves/ed25519 (x25519 export)
 * Keys:       32 bytes each side
 * Result:     32-byte shared secret
 * 
 * Why not NIST P-256/P-384:
 *   - NIST curves have undisclosed parameter origins
 *   - Curve25519 designed transparently by D.J. Bernstein
 *   - Tor itself uses Curve25519
 */

import { x25519 } from '@noble/curves/ed25519';
import { bytesToHex } from '@noble/hashes/utils';

/** X25519 key exchange keypair */
export interface X25519KeyPair {
  /** 32-byte private key */
  privateKey: Uint8Array;
  /** 32-byte public key */
  publicKey: Uint8Array;
}

/**
 * Generate a new X25519 keypair for key exchange.
 * Used in DH ratchet steps and initial key exchange.
 */
export function generateX25519KeyPair(): X25519KeyPair {
  const privateKey = x25519.utils.randomPrivateKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

/**
 * Derive X25519 public key from private key.
 */
export function getX25519PublicKey(privateKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(privateKey);
}

/**
 * Compute shared secret via X25519 ECDH.
 * 
 * Both parties arrive at the same 32-byte secret:
 *   Alice: sharedSecret = X25519(alice_priv, bob_pub)
 *   Bob:   sharedSecret = X25519(bob_priv, alice_pub)
 *   alice_result === bob_result (mathematically guaranteed)
 * 
 * The shared secret is NEVER transmitted on the wire.
 * 
 * @param ourPrivateKey - Our X25519 private key
 * @param theirPublicKey - Their X25519 public key
 * @returns 32-byte shared secret
 */
export function computeSharedSecret(
  ourPrivateKey: Uint8Array,
  theirPublicKey: Uint8Array
): Uint8Array {
  return x25519.getSharedSecret(ourPrivateKey, theirPublicKey);
}

/**
 * Validate that a public key is on the curve and not a low-order point.
 * Prevents small-subgroup attacks.
 */
export function validatePublicKey(publicKey: Uint8Array): boolean {
  if (publicKey.length !== 32) return false;
  
  // Check for all-zero key (identity point — unsafe)
  const allZero = publicKey.every(b => b === 0);
  if (allZero) return false;
  
  // Try computing a shared secret — will throw if invalid
  try {
    const testPriv = x25519.utils.randomPrivateKey();
    x25519.getSharedSecret(testPriv, publicKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Debug helper — hex representation of shared secret.
 * WARNING: Never log this in production.
 */
export function sharedSecretToHex(secret: Uint8Array): string {
  return bytesToHex(secret);
}
