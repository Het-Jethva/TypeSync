# TypeSync Domain Model & Architecture Glossary

This document records the core domain concepts and architecture decisions for TypeSync.

## Domain Concepts

### Collaborative Room Session
An active in-memory session for a **Document** where real-time Yjs CRDT edits, token-bucket rate-limiting, client awareness (cursors and selections), and debounced database persistence are coordinated.
- **Interface Surface**: `joinSession`, `applyUpdate`, `updateAwareness`, `leaveSession`, `evictIfEmpty`, `flushAll`.
- **Implementation**: Hides Yjs `Y.Doc`, `Awareness` state, rate-limiting tokens, join generation counters, and Drizzle DB flushes behind a single module seam.
- **Seam Discipline**: Accepts a `DocumentStateRepository` interface for loading/saving binary document state, allowing zero-DB unit testing via in-memory fakes. Decoupled from transport types via light `RoomOccupancyProvider` and `Broadcaster` callbacks.
- **Rate-Limiting & Preflight**: Encapsulates token-bucket rate-limiting and document size validation, returning typed results (`accepted`, `rate-limited`, `update-too-large`, `invalid`).

### Document Access Authorizer
The security module responsible for verifying whether a user has permission (`owner`, `editor`, `viewer`) to join a **Collaborative Room Session** or perform HTTP mutations on a **Document**, and broadcasting role revocation events when permissions change.
