import { execute, queryOne, getMasterKey } from './database';
import { encrypt, decrypt } from '../crypto/encryption';
import { type X25519KeyPair } from '../crypto';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

/**
 * Save X3DH keys to database, encrypted with master key.
 */
export async function saveX3DHKeys(signedPreKey: X25519KeyPair, oneTimePreKey: X25519KeyPair) {
  const masterKey = getMasterKey();
  if (!masterKey) return; // Memory-only mode

  // Serialize all 4 keys (128 bytes total)
  const toEncrypt = new Uint8Array(32 * 4);
  toEncrypt.set(signedPreKey.privateKey, 0);
  toEncrypt.set(signedPreKey.publicKey, 32);
  toEncrypt.set(oneTimePreKey.privateKey, 64);
  toEncrypt.set(oneTimePreKey.publicKey, 96);

  const { ciphertext, nonce } = encrypt(toEncrypt, masterKey);

  const data = JSON.stringify({
    signedPub: bytesToHex(signedPreKey.publicKey),
    oneTimePub: bytesToHex(oneTimePreKey.publicKey),
    encryptedKeys: bytesToHex(ciphertext),
    nonce: bytesToHex(nonce),
  });

  await execute('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['x3dh_keys', data]);
}

/**
 * Load X3DH keys from database, decrypted with master key.
 */
export async function loadX3DHKeys(): Promise<{ signedPreKeyPair: X25519KeyPair, oneTimePreKeyPair: X25519KeyPair } | null> {
  const masterKey = getMasterKey();
  if (!masterKey) return null;

  const row = await queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['x3dh_keys']);
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value);

    // Decrypt the encrypted key blob
    const encryptedKeys = hexToBytes(parsed.encryptedKeys);
    const nonce = hexToBytes(parsed.nonce);

    const decrypted = decrypt({ ciphertext: encryptedKeys, nonce }, masterKey);

    return {
      signedPreKeyPair: {
        privateKey: decrypted.slice(0, 32),
        publicKey: hexToBytes(parsed.signedPub),
      },
      oneTimePreKeyPair: {
        privateKey: decrypted.slice(64, 96),
        publicKey: hexToBytes(parsed.oneTimePub),
      },
    };
  } catch(e) {
    return null;
  }
}
