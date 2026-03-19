/**
 * GhostChat — X3DH Pre-Key Bundle Manager
 * 
 * Extended Triple Diffie-Hellman for offline messaging.
 * Pre-key bundles stored in DHT (no VPS needed).
 * 
 * How DHT pre-key storage works:
 *   Key:   SHA256(PeerID + "prekey")
 *   Value: Signed pre-key bundle (public keys only — safe to store)
 *   TTL:   7 days (refreshed weekly when online)
 *   Nodes: ~20 DHT peers closest to the key store a copy
 * 
 * X3DH derivation:
 *   DH1 = X25519(alice_ephemeral_priv, bob_signed_prekey_pub)
 *   DH2 = X25519(alice_identity_priv,  bob_signed_prekey_pub)
 *   DH3 = X25519(alice_ephemeral_priv, bob_identity_pub)
 *   DH4 = X25519(alice_identity_priv,  bob_one_time_prekey) — if available
 *   shared = HKDF(DH1 || DH2 || DH3 || DH4, info="ghostchat-x3dh-v1")
 */

import {
  generateX25519KeyPair,
  computeSharedSecret,
  sign,
  verify,
  kdfX3DH,
  type IdentityKeyPair,
  type X25519KeyPair,
} from '../crypto';
import { dhtPut, dhtGet } from '../p2p';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import type { PreKeyBundle, SerializedPreKeyBundle } from '../../types';

/** Pre-key bundle refresh interval (7 days) */
const PREKEY_REFRESH_INTERVAL = 7 * 24 * 60 * 60 * 1000;

/** Local pre-key state (private keys never leave device) */
interface LocalPreKeyState {
  signedPreKeyPair: X25519KeyPair;
  oneTimePreKeyPairs: X25519KeyPair[];
  lastRefresh: number;
}

let localPreKeyState: LocalPreKeyState | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Generate and publish a pre-key bundle to the DHT.
 * 
 * Called on first launch and refreshed every 7 days.
 * Only public keys are published — private keys stay local.
 * 
 * @param identity - Our Ed25519 identity keypair
 * @param peerId - Our PeerID string
 */
export async function publishPreKeyBundle(
  identity: IdentityKeyPair,
  peerId: string
): Promise<void> {
  // Generate signed pre-key
  const signedPreKeyPair = generateX25519KeyPair();
  
  // Sign the pre-key with our identity key
  const signature = sign(signedPreKeyPair.publicKey, identity.privateKey);
  
  // Generate one-time pre-key
  const oneTimePreKeyPair = generateX25519KeyPair();
  
  // Store private keys locally
  localPreKeyState = {
    signedPreKeyPair,
    oneTimePreKeyPairs: [oneTimePreKeyPair],
    lastRefresh: Date.now(),
  };
  
  // Build the bundle (public keys only)
  const bundle: PreKeyBundle = {
    identityKey: identity.publicKey,
    signedPreKeyPub: signedPreKeyPair.publicKey,
    signedPreKeySignature: signature,
    oneTimePreKeyPub: oneTimePreKeyPair.publicKey,
    timestamp: Date.now(),
  };
  
  // Publish to DHT
  const dhtKey = makePreKeyDHTKey(peerId);
  const serialized = serializeBundle(bundle);
  const value = new TextEncoder().encode(JSON.stringify(serialized));
  
  await dhtPut(dhtKey, value);
  
  console.log(`👻 Pre-key bundle published for ${peerId.slice(0, 16)}...`);
}

/**
 * Fetch a peer's pre-key bundle from the DHT.
 * 
 * @param peerId - Target peer's PeerID
 * @returns Pre-key bundle, or null if not found
 */
export async function fetchPreKeyBundle(
  peerId: string
): Promise<PreKeyBundle | null> {
  const dhtKey = makePreKeyDHTKey(peerId);
  const value = await dhtGet(dhtKey);
  
  if (!value) {
    console.warn(`👻 No pre-key bundle found for ${peerId.slice(0, 16)}...`);
    return null;
  }
  
  try {
    const json = JSON.parse(new TextDecoder().decode(value)) as SerializedPreKeyBundle;
    const bundle = deserializeBundle(json);
    
    // Verify the signature
    const valid = verify(
      bundle.signedPreKeyPub,
      bundle.signedPreKeySignature,
      bundle.identityKey
    );
    
    if (!valid) {
      console.error(`👻 INVALID pre-key bundle signature for ${peerId.slice(0, 16)}...`);
      return null;
    }
    
    return bundle;
  } catch (err) {
    console.error('Failed to parse pre-key bundle:', err);
    return null;
  }
}

/**
 * Perform X3DH as Alice (initiator) to establish shared secret with offline Bob.
 * 
 * DH1 = X25519(alice_ephemeral_priv, bob_signed_prekey_pub)
 * DH2 = X25519(alice_identity_priv,  bob_signed_prekey_pub)
 * DH3 = X25519(alice_ephemeral_priv, bob_identity_pub)
 * DH4 = X25519(alice_identity_priv,  bob_one_time_prekey)  — if available
 * 
 * @param ourIdentity - Alice's Ed25519 identity (converted to X25519)
 * @param ourIdentityX25519 - Alice's X25519 identity private key
 * @param bobBundle - Bob's pre-key bundle from DHT
 * @returns Shared secret + ephemeral public key to send to Bob
 */
export function performX3DHInitiator(
  ourIdentityX25519PrivateKey: Uint8Array,
  bobBundle: PreKeyBundle
): { sharedSecret: Uint8Array; ephemeralPublicKey: Uint8Array } {
  // Generate ephemeral keypair
  const ephemeral = generateX25519KeyPair();
  
  // Compute DH values
  const dh1 = computeSharedSecret(ephemeral.privateKey, bobBundle.signedPreKeyPub);
  const dh2 = computeSharedSecret(ourIdentityX25519PrivateKey, bobBundle.signedPreKeyPub);
  const dh3 = computeSharedSecret(ephemeral.privateKey, bobBundle.identityKey);
  
  const dhResults = [dh1, dh2, dh3];
  
  // DH4 with one-time pre-key if available
  if (bobBundle.oneTimePreKeyPub) {
    const dh4 = computeSharedSecret(ourIdentityX25519PrivateKey, bobBundle.oneTimePreKeyPub);
    dhResults.push(dh4);
  }
  
  // Derive shared secret
  const sharedSecret = kdfX3DH(dhResults);
  
  return {
    sharedSecret,
    ephemeralPublicKey: ephemeral.publicKey,
  };
}

/**
 * Perform X3DH as Bob (responder) upon receiving Alice's initial message.
 * 
 * @param aliceIdentityKey - Alice's identity public key (X25519)
 * @param aliceEphemeralKey - Alice's ephemeral public key
 * @param usedOneTimePreKey - Whether Alice used a one-time pre-key
 * @returns Shared secret
 */
export function performX3DHResponder(
  aliceIdentityKey: Uint8Array,
  aliceEphemeralKey: Uint8Array,
  usedOneTimePreKey: boolean
): Uint8Array {
  if (!localPreKeyState) {
    throw new Error('No local pre-key state — pre-key bundle not published');
  }
  
  const { signedPreKeyPair, oneTimePreKeyPairs } = localPreKeyState;
  
  // Compute DH values (mirror of Alice's computation)
  const dh1 = computeSharedSecret(signedPreKeyPair.privateKey, aliceEphemeralKey);
  const dh2 = computeSharedSecret(signedPreKeyPair.privateKey, aliceIdentityKey);
  const dh3 = computeSharedSecret(signedPreKeyPair.privateKey, aliceEphemeralKey);
  
  const dhResults = [dh1, dh2, dh3];
  
  // DH4 with one-time pre-key
  if (usedOneTimePreKey && oneTimePreKeyPairs.length > 0) {
    const otpk = oneTimePreKeyPairs[0];
    const dh4 = computeSharedSecret(otpk.privateKey, aliceIdentityKey);
    dhResults.push(dh4);
    
    // Remove used one-time pre-key (one-time = used once)
    oneTimePreKeyPairs.shift();
  }
  
  return kdfX3DH(dhResults);
}

/**
 * Start periodic pre-key refresh.
 */
export function startPreKeyRefresh(
  identity: IdentityKeyPair,
  peerId: string
): void {
  stopPreKeyRefresh();
  
  refreshTimer = setInterval(async () => {
    try {
      await publishPreKeyBundle(identity, peerId);
    } catch (err) {
      console.warn('Pre-key refresh failed:', err);
    }
  }, PREKEY_REFRESH_INTERVAL);
}

/**
 * Stop pre-key refresh.
 */
export function stopPreKeyRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function makePreKeyDHTKey(peerId: string): Uint8Array {
  const input = new TextEncoder().encode(peerId + 'prekey');
  return sha256(input);
}

function serializeBundle(bundle: PreKeyBundle): SerializedPreKeyBundle {
  return {
    identityKey: bytesToHex(bundle.identityKey),
    signedPreKeyPub: bytesToHex(bundle.signedPreKeyPub),
    signature: bytesToHex(bundle.signedPreKeySignature),
    oneTimePreKeyPub: bundle.oneTimePreKeyPub ? bytesToHex(bundle.oneTimePreKeyPub) : null,
    timestamp: bundle.timestamp,
  };
}

function deserializeBundle(json: SerializedPreKeyBundle): PreKeyBundle {
  return {
    identityKey: hexToBytes(json.identityKey),
    signedPreKeyPub: hexToBytes(json.signedPreKeyPub),
    signedPreKeySignature: hexToBytes(json.signature),
    oneTimePreKeyPub: json.oneTimePreKeyPub ? hexToBytes(json.oneTimePreKeyPub) : null,
    timestamp: json.timestamp,
  };
}
