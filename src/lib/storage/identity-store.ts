/**
 * GhostChat — Identity Persistence
 * Saves/loads Ed25519 keypair from SQLite so Ghost ID is stable across restarts.
 */

import { execute, queryOne } from './database';
import { generateIdentity, type IdentityKeyPair } from '../crypto/identity';
import { encrypt, decrypt } from '../crypto/encryption';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

const KEY_PUB   = 'identity_pub_hex';
const KEY_PRIV  = 'identity_priv_enc';
const KEY_NONCE = 'identity_priv_nonce';

async function getSetting(key: string): Promise<string | null> {
  const row = await queryOne<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?', [key]
  );
  return row?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  await execute(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

let cachedIdentity: IdentityKeyPair | null = null;

/**
 * Get cached identity (for restart scenarios after initial load).
 */
export function getCachedIdentity(): IdentityKeyPair | null {
  return cachedIdentity;
}

/**
 * Load identity from DB, or generate + persist a new one.
 * Call once on startup before creating the libp2p node.
 * @param masterKey - Key derived from OS secure enclave (Argon2id), used for identity encryption
 */
export async function loadOrCreateIdentity(masterKey: Uint8Array): Promise<IdentityKeyPair> {
  if (cachedIdentity) return cachedIdentity;

  const pubHex = await getSetting(KEY_PUB);

  if (pubHex) {
    // Identity exists — decrypt and return it using master key
    const privEncHex  = await getSetting(KEY_PRIV);
    const nonceHex    = await getSetting(KEY_NONCE);

    if (!privEncHex || !nonceHex) {
      console.warn('👻 Identity storage corrupt — regenerating');
      return createAndSaveIdentity(masterKey);
    }

    try {
      const privBytes = decrypt(
        { ciphertext: hexToBytes(privEncHex), nonce: hexToBytes(nonceHex) },
        masterKey
      );

      const identity: IdentityKeyPair = {
        privateKey: privBytes,
        publicKey:  hexToBytes(pubHex),
      };

      console.log('👻 Identity loaded from storage');
      cachedIdentity = identity;
      return identity;
    } catch (err) {
      console.warn('👻 Identity decryption failed — regenerating');
      return createAndSaveIdentity(masterKey);
    }
  }

  return createAndSaveIdentity(masterKey);
}

async function createAndSaveIdentity(masterKey: Uint8Array): Promise<IdentityKeyPair> {
  const identity = generateIdentity();

  // Use master key for identity encryption (derived from OS secure enclave)
  const { ciphertext, nonce } = encrypt(identity.privateKey, masterKey);

  await setSetting(KEY_PUB,    bytesToHex(identity.publicKey));
  await setSetting(KEY_PRIV,   bytesToHex(ciphertext));
  await setSetting(KEY_NONCE,  bytesToHex(nonce));

  console.log('👻 New identity generated and saved');
  return identity;
}

/**
 * Wipe identity from DB (for "factory reset" / panic wipe).
 */
export async function wipeIdentity(): Promise<void> {
  for (const key of [KEY_PUB, KEY_PRIV, KEY_NONCE]) {
    await execute('DELETE FROM settings WHERE key = ?', [key]);
  }
  console.log('👻 Identity wiped');
}
