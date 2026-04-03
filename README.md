# GhostChat

**Pure P2P Encrypted Messenger — No Servers, No Trace**

GhostChat is a pure peer-to-peer, end-to-end encrypted messaging application. Built with Rust, Tauri, and React, it operates entirely without central servers. Every installation acts as a relay, a DHT node, and a peer, utilizing libp2p for decentralized networking and the Signal Double Ratchet algorithm for robust cryptographic security.

## Features

- **Pure P2P Network**: Serverless architecture using libp2p. Includes Transport layers for WebRTC, QUIC, TCP, and Circuit Relays.
- **NAT Traversal**: Automatic network probing via STUN, enabling seamless hole-punching for Cone and Symmetric NATs.
- **End-to-End Encryption**: Implements the Signal Double Ratchet protocol with X3DH and Noise XX mutual authentication.
- **OS Enclave Security**: Database master keys are derived via Argon2id and securely vaulted in the native operating system's credentials manager (Keychain/Libsecret).
- **Tor Integration**: Optional Tor sidecar mode binds listeners exclusively to localhost hidden services, routing traffic for maximum anonymity.
- **Anti-Capture APIs**: OS-level anti-screenshot and screen recording protection enabled by default.
- **Local Storage**: Built-in encrypted SQLite database for offline message retention.

## Ghost ID Format

Your identity is your libp2p PeerID, derived from your Ed25519 public key.

```
Format:  12D3KooW + Base58(SHA256(Ed25519_pubkey))
Example: 12D3KooWGzBk1DtFN9hE3Cw6hXfK3JHv6bDq4oFXzN7L4y5Q8pR
```

- The PeerID is the identity. No usernames, no phone numbers.
- Derived deterministically from your Ed25519 key, making it fully regenerable.

## Connection State Machine

1. **Cold Start**: App initializes and fetches secure master key from OS Enclave.
2. **Bootstrapping**: Contacting bootstrap peers via public DHT nodes, mDNS LAN scans, or manual multiaddrs.
3. **Discovery**: Kademlia lookup resolves target PeerIDs to routable Multiaddrs.
4. **Dialing**: Attempts QUIC or WebRTC first. If behind a heavy Symmetric NAT, falls back to Circuit Relay and attempts a DCuTR upgrade.
5. **Handshake**: Initializes X3DH if offline, or Noise XX mutual authentication if actively dialing.
6. **Session**: Double Ratchet is initialized from the shared secret.

## Architecture & Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Tauri 2.0 (Rust + Web) |
| Frontend | React 18 + TypeScript + Tailwind CSS |
| State | Zustand |
| Crypto | @noble/curves, @noble/hashes, @noble/ciphers |
| P2P | libp2p (Kademlia DHT, Circuit Relay, QUIC, WebRTC, DCuTR) |
| Database | tauri-plugin-sql (native SQLite) + AES-256-GCM |
| Privacy | Tor sidecar, Argon2id, OS Keyring, Anti-Screenshot |

## Cryptographic Primitives

| Purpose | Algorithm |
|---------|-----------|
| Identity | Ed25519 |
| Key Exchange | X25519 ECDH |
| Key Derivation | HKDF-SHA256 |
| Encryption | AES-256-GCM |
| Ratchet | Double Ratchet (custom) |
| Handshake | Noise XX, X3DH with Signed Pre-Keys |
| Password | Argon2id (64MB) |

## Security Properties

- **Forward secrecy**: Each message key is unique and deleted immediately after use.
- **Break-in recovery**: DH ratchet steps ensure future messages remain safe even if current chain keys are compromised.
- **No metadata on wire**: Tor routing hides sender and receiver metadata.
- **Encrypted at rest**: Field-level AES-256-GCM encryption in native SQLite. Master keys persist only in OS Secure Enclaves.
- **Spoofing Protection**: X3DH implementation utilizes securely persisted Medium-term Signed Pre-Keys.
- **Anti-Capture**: Application canvas is actively shielded from OS screenshot processes.

## Development

```bash
# Install dependencies
pnpm install

# Run frontend only
pnpm dev

# Run full Tauri app (Rust + frontend)
pnpm tauri dev

# Build for production
pnpm tauri build
```

## License

AGPL v3
