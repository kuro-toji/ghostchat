/**
 * GhostChat — Identity Persistence
 * Saves/loads Ed25519 keypair from SQLite so Ghost ID is stable across restarts.
 */

import { execute, queryOne } from './database';
import { generateIdentity, type IdentityKeyPair } from '../crypto/identity';
import { encrypt, decrypt } from '../crypto/encryption';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';

const KEY_PUB   = 'identity_pub_hex';
const KEY_PRIV  = 'identity_priv_enc';
const KEY_NONCE = 'identity_priv_nonce';
const KEY_ENCKEY = 'identity_enc_key';

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
 * Load identity from DB, or generate + persist a new one.
 * Call once on startup before creating the libp2p node.
 */
export async function loadOrCreateIdentity(): Promise<IdentityKeyPair> {
  if (cachedIdentity) return cachedIdentity;

  const pubHex = await getSetting(KEY_PUB);

  if (pubHex) {
    // Identity exists — decrypt and return it
    const privEncHex  = await getSetting(KEY_PRIV);
    const nonceHex    = await getSetting(KEY_NONCE);
    const encKeyHex   = await getSetting(KEY_ENCKEY);

    if (!privEncHex || !nonceHex || !encKeyHex) {
      console.warn('👻 Identity storage corrupt — regenerating');
      return createAndSaveIdentity();
    }

    try {
      const encKey    = hexToBytes(encKeyHex);
      const privBytes = decrypt(
        { ciphertext: hexToBytes(privEncHex), nonce: hexToBytes(nonceHex) },
        encKey
      );

      const identity: IdentityKeyPair = {
        privateKey: privBytes,
        publicKey:  hexToBytes(pubHex),
      };

      console.log('👻 Identity loaded from storage');
      cachedIdentity = identity;
      return identity;
    } catch (err) {
      console.warn('👻 Identity decryption failed (likely memory-mode/Store mismatch) — regenerating');
      return createAndSaveIdentity();
    }
  }

  return createAndSaveIdentity();
}

async function createAndSaveIdentity(): Promise<IdentityKeyPair> {
  const identity = generateIdentity();

  // Random encryption key (replace with Argon2id master key when password auth added)
  const encKey  = randomBytes(32);
  const { ciphertext, nonce } = encrypt(identity.privateKey, encKey);

  await setSetting(KEY_PUB,    bytesToHex(identity.publicKey));
  await setSetting(KEY_PRIV,   bytesToHex(ciphertext));
  await setSetting(KEY_NONCE,  bytesToHex(nonce));
  await setSetting(KEY_ENCKEY, bytesToHex(encKey));

  console.log('👻 New identity generated and saved');
  return identity;
}

/**
 * Wipe identity from DB (for "factory reset" / panic wipe).
 */
export async function wipeIdentity(): Promise<void> {
  for (const key of [KEY_PUB, KEY_PRIV, KEY_NONCE, KEY_ENCKEY]) {
    await execute('DELETE FROM settings WHERE key = ?', [key]);
  }
  console.log('👻 Identity wiped');
}
