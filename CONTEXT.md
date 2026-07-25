# TypeSync Domain Model & Architecture Glossary

This document records the core domain concepts and architecture decisions for TypeSync.

## Domain Concepts

### Collaborative Room Session
An active in-memory session for a **Document** where real-time Yjs CRDT edits, token-bucket rate-limiting, client awareness (cursors and selections), and debounced database persistence are coordinated.
- **Presence Semantics**: A collaborator is present only while their connection is active. The session sends one removal update to remaining collaborators before discarding that connection's awareness state.
- **Interface Surface**: `joinSession`, `applyUpdate`, `updateAwareness`, `leaveSession`, `evictIfEmpty`, `flushAll`.
- **Implementation**: Hides Yjs `Y.Doc`, `Awareness` state, rate-limiting tokens, join generation counters, and Drizzle DB flushes behind a single module seam.
- **Seam Discipline**: Accepts a `DocumentStateRepository` interface for loading/saving binary document state, allowing zero-DB unit testing via in-memory fakes. Coordinates room admission, awareness, and departure through a live Socket adapter so those lifecycle rules stay together.
- **Rate-Limiting & Preflight**: Encapsulates token-bucket rate-limiting and document size validation, returning typed results (`accepted`, `rate-limited`, `update-too-large`, `invalid`).

### Document Access Authorizer
The security module responsible for verifying whether a user has permission (`owner`, `editor`, `viewer`) to join a **Collaborative Room Session** or perform HTTP mutations on a **Document**, and reconciling active sessions when Document access changes.
- **Authorization Scope**: The same role policy governs socket admission and HTTP Document mutations.
- **Access-change Semantics**: Persisted Document access is authoritative. A grant, role change, or revocation reconciles every active connection for that user and Document before publication; a delivery failure never restores old rights, and a later join re-evaluates persisted access. Callers receive success once persistence and server-side session enforcement complete.
- **Join Semantics**: A new grant authorizes a later explicit join. It does not automatically enter a connection into a Document room.
- **Role-change Semantics**: A role change that retains access updates active connections in place and preserves awareness. Only revocation ends room membership and presence.
- **Interface Surface**: `grantAccess`, `revokeAccess`, `authorizeSocketSession`.

### Collaborative Sync Manager
The client-side module responsible for buffering offline edits, merging pending Yjs updates, managing exponential backoff retries, reconciling state-vector deltas upon reconnection, and gating outgoing awareness by a confirmed session join.
- **Delivery Ownership**: The manager makes the final send decision for Document and awareness frames. The Document hook observes and encodes Yjs awareness; the Collaborative Room Session publishes departure removal.
- **Awareness Semantics**: Awareness is ephemeral. The manager drops frames while disconnected and publishes the latest local state after a successful join; it sends volatile, unacknowledged frames and never queues or retries awareness.
- **Interface Surface**: `enqueueUpdate`, `reconcileDelta`, `retryWithBackoff`, `subscribe`.
