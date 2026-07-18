# ARCHITECTURE — Accord

> End-to-end encrypted, zero-trust P2P network, with a Discord-style desktop application.
> This document is a **contract**. The structural decisions are summarized
> in §7. The exact wire specification (bytes, state machines) lives in `SPEC.md`.

## 1. Overview

Accord is made of two logical processes within a single desktop application (Tauri):

```
┌───────────────────────────────────────────────────────────────────┐
│  Tauri application (single binary)                               │
│                                                                   │
│  ┌─────────────────────────┐      ┌────────────────────────────┐  │
│  │  UI (WebView)           │      │  Accord node (Rust)        │  │
│  │  React + TS + Tailwind  │◄────►│  transport / crypto / dht  │  │
│  │                         │  WS  │  core / voice / api        │  │
│  │  JSON-RPC 2.0 client    │127.0.│                            │  │
│  └─────────────────────────┘  0.1 └──────────┬─────────────────┘  │
└──────────────────────────────────────────────┼────────────────────┘
                                               │ UDP + TCP (encrypted)
                                               ▼
                                        Accord P2P network
```

- The **node** is a Rust library (`accord-node`) embedded in the Tauri process,
  which talks to the P2P network. It can also run as a standalone binary (`accord-noded`) for
  multi-node integration tests.
- The **UI** never talks to the network: it consumes exclusively the local JSON-RPC 2.0 API
  over WebSocket on `127.0.0.1`, authenticated by session token (see `API.md`).

## 2. Layers and crates

```
accord/
├── crates/
│   ├── accord-proto      # Packet types, binary encoding, framing, versioning
│   ├── accord-crypto     # Identities, handshake, sessions, encrypted storage, mnemonic
│   ├── accord-transport  # UDP/TCP, NAT traversal, relays, anti-DoS, keep-alive
│   ├── accord-dht        # 256-bit Kademlia: routing, RPC, storage, replication
│   ├── accord-core       # Messaging, groups/roles, files, offline queues,
│   │                     # friend codes, mailboxes, search index
│   ├── accord-voice      # cpal capture/playback, Opus, encrypted voice mesh
│   ├── accord-api        # Local WebSocket JSON-RPC 2.0 server
│   └── accord-node       # Assembly: node runtime + accord-noded binary
├── app/                  # Tauri 2 + React + TypeScript + Tailwind
├── tests/                # Multi-node network integration tests, simulation
└── ci.sh
```

### Dependency graph (compile-time)

```
proto ──► crypto ──► transport ──► dht ──► core ──► api ──► node ──► app (Tauri)
  │          │           │          │        │
  └──────────┴───────────┴──────────┴────────┘   voice depends on: proto, crypto, transport, core
```

- `proto` depends on nothing (pure types + encoding).
- `crypto` depends on `proto` (handshake transcripts).
- `transport` depends on `crypto` (every non-handshake network frame is encrypted).
- `dht` depends on `transport` (RPC over encrypted sessions).
- `core` depends on `dht` (resolution, mailboxes, file blocks).
- `voice` depends on `transport` (session UDP stream) and `core` (channel signaling).
- `api` exposes `core` + `voice` + network state.
- `node` wires everything together; `app` (Tauri) hosts `node` and the UI.

### Execution graph (runtime, tokio)

Each node runs:

1. **Transport loop**: UDP/TCP reception, handshake/session demultiplexing,
   decoding, delivery to subscribers (dht, core, voice).
2. **DHT loop**: bucket refresh, republishing, storage expiration.
3. **Core loop**: offline queues (backoff), mailbox pickup,
   file re-replication, presence/application-level pings.
4. **Voice loop** (if a channel is active): 20 ms capture → Opus → encryption → UDP,
   and the reverse path with a jitter buffer.
5. **API server**: local WebSocket, push notifications to the UI.

All inter-task communication goes through bounded `tokio::sync::mpsc`
channels; no lock is held across an `await`.

## 3. Local data model

- **SQLite** database (via `rusqlite`, WAL enabled) encrypted at rest: sensitive values
  (message bodies, contact names, FTS index) are encrypted with
  XChaCha20-Poly1305 using a key derived from the identity (see `SPEC.md` §2.6). The
  sort metadata (logical timestamps, ids) stays in the clear locally for
  indexing — the file never leaves the machine.
- Search index: SQLite **FTS5** over text decrypted in memory, stored in an
  FTS table itself encrypted at the application page level (HMAC-hashed tokens for
  exact search + HMAC trigrams for prefix). Tradeoff documented in
  §7 (decision D-011).
- Atomic writes: SQLite WAL + one transaction per logical operation; corruption
  detection at startup (`PRAGMA integrity_check`) with restore from the
  last healthy checkpoint.

## 4. Identities and trust

- Identity = immutable Ed25519 pair. `NodeId = SHA-256(pubkey)` (256 bits).
- Proof of work at identity generation (zero prefix on
  `SHA-256(pubkey ‖ pow_nonce)`, 16-bit difficulty by default) to make
  Sybil attacks more expensive. Verified by every peer on first encounter.
- Zero-trust: no server, no trusted third party. Every piece of data received from the network is
  (a) authenticated by signature or session key, (b) structurally validated,
  (c) rate-limited. Storage nodes (DHT, mailboxes, file
  blocks) only ever see opaque blobs.

## 5. Groups: signed operation log

A group's state (metadata, channels, categories, members, roles, permissions,
pins, bans) is a **signed operation log** (op-log):

- Each op carries: Lamport clock, wall-clock timestamp, author (pubkey), signature,
  implicit parent(s) via the Lamport clock.
- **Deterministic LWW** conflict resolution ordered by `(lamport, author_id)` —
  choice justified in §7 (decision D-007) over a full CRDT: group ops
  are rare, and the simple total order is auditable and sufficient.
- Authorization: each op is validated against the permission state *at the point
  of insertion* in the total order. An unauthorized op is ignored by all honest
  replicas (same deterministic rule everywhere).
- Kick/ban ⇒ group key rotation (see `SPEC.md` §6.4): new
  messages are undecryptable by the departed member.

## 6. Voice

- Voice channel = **full mesh** ≤ 10 participants. Signaling via the group (op-log +
  control messages), media over UDP on the existing transport sessions.
- Opus 48 kHz mono, 20 ms frames, adaptive bitrate 16–64 kbit/s driven by measured
  loss (RTP-like sequence counters, see `SPEC.md` §8).
- Adaptive jitter buffer (target = p95 inter-arrival + 20 ms, bounds 40–200 ms),
  PLC provided by the Opus decoder.
- **Future extension (out of scope for v1)**: channel signaling reserves a
  `media_kinds: bitflags{AUDIO, VIDEO, SCREEN}` field and media packets carry a
  `media_type` byte. Video/screen sharing can therefore be added without breaking the protocol
  (SFU-less video mesh to be studied; likely a star topology over relays).

## 7. Structural decisions

| # | Decision | Short rationale |
|---|----------|----------------------|
| D-001 | RustCrypto crates (ed25519-dalek, x25519-dalek, chacha20poly1305, argon2) instead of sodiumoxide/ring | sodiumoxide unmaintained, ring lacks XChaCha20/Argon2id; priority #1 = security |
| D-002 | Custom binary encoding (not MessagePack) | full control of sizes, explicit versioning, zero parsing dependency |
| D-003 | All signaling (DHT included) goes through encrypted sessions | "no cleartext data on the network"; only handshake packets have a cleartext header |
| D-007 | LWW op-log (lamport, author) rather than delta CRDT | auditable simplicity, rare ops |
| D-011 | FTS index over HMAC tokens | local search without cleartext text on disk |

## 8. Threat model (summary — details in SECURITY.md)

Protects against: passive/active network observer, malicious DHT node, malicious
relay, disk theft. Does not protect against: global traffic analysis
(IP metadata), compromise of the user's OS, massive targeted denial of service.
