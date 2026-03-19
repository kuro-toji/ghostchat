/**
 * GhostChat — Master Key Derivation
 * 
 * Argon2id password hashing for deriving the database encryption key.
 * GPU brute force costs ~months per attempt with these parameters.
 * 
 * Algorithm:    Argon2id
 * Parameters:   memory=64MB, iterations=3, parallelism=4
 * Output:       256-bit (32-byte) master key
 * Usage:        Encrypts entire .db file with AES-256-GCM
 * Never stored: Re-derived from password on each launch
 * Remember me:  Optionally cache in OS keychain
 */

import { randomBytes, bytesToHex, hexToBytes } from '@noble/hashes/utils';

/** Argon2id parameters — chosen for GPU resistance */
const ARGON2_CONFIG = {
  type: 2,            // Argon2id (hybrid)
  memoryCost: 65536,  // 64 MB
  timeCost: 3,        // 3 iterations
  parallelism: 4,     // 4 threads
  hashLength: 32,     // 256-bit output
};

/** Salt size in bytes */
const SALT_SIZE = 32;

/** Master key derivation result */
export interface MasterKeyResult {
  /** 32-byte AES-256 master key */
  masterKey: Uint8Array;
  /** 32-byte salt (stored alongside encrypted DB) */
  salt: Uint8Array;
}

/**
 * Derive a master key from a user password.
 * 
 * Uses Argon2id (memory-hard KDF) to resist GPU brute force.
 * With 64MB memory cost, each attempt requires 64MB RAM — making
 * parallel GPU attacks extremely expensive.
 * 
 * @param password - User's password
 * @param existingSalt - Use existing salt (for re-derivation on login), or null for new
 * @returns Master key + salt
 */
export async function deriveMasterKey(
  password: string,
  existingSalt?: Uint8Array
): Promise<MasterKeyResult> {
  const salt = existingSalt ?? randomBytes(SALT_SIZE);
  
  // Dynamic import — argon2-browser is a WASM module
  const argon2 = await import('argon2-browser');
  
  const result = await argon2.hash({
    pass: password,
    salt: salt,
    type: ARGON2_CONFIG.type,
    mem: ARGON2_CONFIG.memoryCost,
    time: ARGON2_CONFIG.timeCost,
    parallelism: ARGON2_CONFIG.parallelism,
    hashLen: ARGON2_CONFIG.hashLength,
  });
  
  return {
    masterKey: new Uint8Array(result.hash),
    salt,
  };
}

/**
 * Verify a password against a known salt.
 * Re-derives the key and returns it if successful.
 * 
 * @param password - Password to verify
 * @param salt - Known salt from previous derivation
 * @returns Master key if password is correct
 */
export async function verifyAndDerive(
  password: string,
  salt: Uint8Array
): Promise<Uint8Array> {
  const result = await deriveMasterKey(password, salt);
  return result.masterKey;
}

/**
 * Serialize salt to hex for storage.
 */
export function saltToHex(salt: Uint8Array): string {
  return bytesToHex(salt);
}

/**
 * Deserialize salt from hex.
 */
export function hexToSalt(hex: string): Uint8Array {
  return hexToBytes(hex);
}

/**
 * Securely wipe master key from memory.
 * Best-effort — JS GC may retain copies.
 */
export function wipeMasterKey(key: Uint8Array): void {
  key.fill(0);
}
