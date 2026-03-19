# 👻 GhostChat

**Pure P2P Encrypted Messenger — No Servers, No Trace**

Every GhostChat install is a relay + DHT node + peer. The network exists only because users exist.

## Architecture

```
THis App IS a node → DHT → Other peer
No servers. No VPS. No central point.
```

---

## Ghost ID Format

Your identity is your **libp2p PeerID**, derived from your Ed25519 public key.

```
Format:  12D3KooW + Base58(SHA256(Ed25519_pubkey))
Example: 12D3KooWGzBk1DtFN9hE3Cw6hXfK3JHv6bDq4oFXzN7L4y5Q8pR
Display: 12D3KooWGz...Q8pR (truncated)
```

- The PeerID IS the identity. No usernames, no phone numbers.
- Share it via QR code, paste in another chat, or speak it aloud.
- Derived deterministically from your Ed25519 key — regenerable.

---

## Connection State Machine

Cold start to first encrypted message:

```
┌─────────────┐
│  COLD_START  │  App just launched
└──────┬──────┘
       │
       ▼
┌──────────────────┐
│  BOOTSTRAPPING   │  Contacting bootstrap peers...
│                  │  ┌─ Tier 1: Protocol Labs DHT nodes
│                  │  ├─ Tier 2: mDNS LAN scan (non-Tor)
│                  │  └─ Tier 3: Manual peer add
└──────┬──────────┘
       │  ≥1 peer responds
       ▼
┌──────────────┐
│  DHT_JOINED  │  Routing table has entries
└──────┬──────┘
       │  ≥3 peers
       ▼
┌──────────┐
│  READY   │  Can discover peers, relay, serve DHT
└──────┬──┘
       │  User selects contact
       ▼
┌──────────────────┐
│  PEER_DISCOVERY  │  Kademlia lookup by PeerID
└──────┬──────────┘
       │  Found multiaddrs
       ▼
┌───────────────┐
│  CONNECTING   │  Dial: WebRTC → WebSocket → Circuit Relay
│               │  Retry: 1s, 2s, 4s, 8s... max 60s
└──────┬───────┘
       │
       ▼
┌───────────────────┐
│  NOISE HANDSHAKE  │  Noise XX → mutual authentication
│                   │  → derive shared secret (32 bytes)
└──────┬───────────┘
       │
       ▼
┌─────────────────────┐
│  DOUBLE RATCHET     │  Initialize from shared secret
│  SESSION ACTIVE     │  Forward secrecy enabled
└──────┬─────────────┘
       │
       ▼
    💬 First encrypted message sent
```

### Failure paths

| Failure | Fallback | Recovery |
|---------|----------|----------|
| All bootstrap peers down | mDNS LAN scan → manual peer add | User pastes a multiaddr |
| Peer behind symmetric NAT | WebRTC ICE/STUN (65% success) → circuit relay | DCuTR upgrade attempt |
| Both peers behind symmetric NAT | Circuit relay through a third peer | Requires ≥1 public peer |
| No relay peers available | Connection fails | Queued for retry |
| Tor bootstrap timeout (>120s) | Clearnet WebRTC for DHT join only | Messages wait for Tor |

---

## Bootstrap & Relay Strategy

### DHT Bootstrap (3-tier fallback)

```
Tier 1: HARDCODED BOOTSTRAP PEERS
  Protocol Labs public DHT nodes (NOT our servers)
  Purpose: Initial DHT join only
  After first contact: cached locally, never needed again

Tier 2: mDNS LAN DISCOVERY
  Broadcasts on local network (disabled in Tor mode)
  Two laptops on same WiFi find each other without internet

Tier 3: MANUAL PEER ADD
  User pastes multiaddr from a friend
  /ip4/1.2.3.4/tcp/4001/ws/p2p/12D3KooW...
  No servers needed at all
```

### Relay Strategy

Every GhostChat install runs `circuitRelayServer()`:
- **Every node is a relay** — no dedicated relay infrastructure
- Relay peers see **only encrypted bytes** — never keys or plaintext
- DCuTR attempts to upgrade relayed connections to direct
- Config: max 128 concurrent reservations, 128 KB/s per connection
- Minimum requirement: ≥1 peer with public IP or port-forwarded

### Tor Fallback During Bootstrap

Tor startup takes 30-60 seconds. During this time:
1. Clearnet WebRTC is allowed for **DHT join only** (no message content)
2. DHT join info is not sensitive (just "I exist on the network")
3. Once Tor is ready: all connections migrate to Tor
4. Message sending waits for Tor — **no plaintext messages over clearnet**

---

## Rust Backend Role

The Rust backend (Tauri) does **two things only**:

1. **Tor sidecar control** — spawn/stop `tor` binary, parse bootstrap progress, read `.onion` address
2. **SQLite database** — native SQLite via `tauri-plugin-sql` for persistent encrypted storage

**All crypto happens in TypeScript** (browser-side via `@noble/*` WASM):
- The Rust backend **never** touches private keys, plaintext, or encryption
- This is intentional — the browser context is the trust boundary

---

## Platform Support

| Platform | Status | Transport |
|----------|--------|-----------|
| **Linux** |  Primary | WebRTC + WebSocket + Tor |
| **macOS** |  Supported | WebRTC + WebSocket + Tor |
| **Windows** |  Supported | WebRTC + WebSocket + Tor |
| **Android** | Planned | Tauri mobile (WebSocket + Tor) |
| **iOS** |  Planned | Tauri mobile (WebSocket + Tor) |

Desktop builds: `pnpm tauri build`
Mobile: Tauri 2.0 mobile targets (when ready)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Tauri 2.0 (Rust + Web) |
| Frontend | React 18 + TypeScript 5 (strict) |
| Bundler | Vite 5 |
| Styling | Tailwind CSS 3 |
| Animation | Framer Motion 11 |
| State | Zustand 4 |
| Crypto | @noble/curves, @noble/hashes, @noble/ciphers |
| P2P | libp2p (Kademlia DHT, GossipSub, Circuit Relay v2) |
| Transport | WebRTC + WebSocket (direct), WebSocket (Tor) |
| Database | tauri-plugin-sql (native SQLite) + field-level AES-256-GCM |
| Privacy | Tor sidecar, Argon2id, memory-only mode |

## Cryptographic Primitives

| Purpose | Algorithm | Library |
|---------|-----------|---------|
| Identity | Ed25519 | @noble/curves |
| Key Exchange | X25519 ECDH | @noble/curves |
| Key Derivation | HKDF-SHA256 | @noble/hashes |
| Encryption | AES-256-GCM | @noble/ciphers |
| Ratchet | Double Ratchet (custom) | Built-in |
| Handshake | Noise XX | Built-in |
| Verification | Safety Numbers (60-digit) | Built-in |
| Password | Argon2id (64MB) | argon2-browser |

## Security Properties

- **Forward secrecy**: Each message key is unique and deleted after use
- **Break-in recovery**: DH ratchet step makes future messages safe even if current keys compromised
- **No metadata on wire**: Tor hides who is talking to whom
- **Encrypted at rest**: Field-level AES-256-GCM in native SQLite
- **Memory-hard passwords**: Argon2id (64MB) resists GPU brute force
- **Safety numbers**: Signal-style 60-digit verification codes
- **Memory-only mode**: `initMemoryDatabase()` uses SQLite `:memory:` — zero disk writes

---

## Development

```bash
# Install dependencies
pnpm install

# Run frontend only (hot reload)
pnpm dev

# Run full Tauri app (Rust + frontend)
pnpm tauri dev

# Build for production
pnpm tauri build
```

## Project Structure

```
ghostchat/
├── src/                        # Frontend (React + TypeScript)
│   ├── components/             # UI components (10 files)
│   ├── stores/                 # Zustand state management (4 files)
│   ├── hooks/                  # React hooks (3 files)
│   ├── lib/
│   │   ├── crypto/             # Cryptographic core (8 files)
│   │   ├── p2p/                # P2P networking (9 files)
│   │   ├── storage/            # Encrypted storage (5 files)
│   │   └── tor/                # Tor frontend integration
│   ├── types/                  # TypeScript interfaces
│   └── utils/                  # Utility functions
├── src-tauri/                  # Rust backend
│   └── src/
│       ├── main.rs             # Entry + plugin registration
│       ├── tor.rs              # Tor sidecar controller
│       └── commands.rs         # IPC commands (Tor only)
└── package.json
```

## License

MIT
