# TypeSync

Real-time collaborative document editor built on Yjs CRDTs, with a server that
participates in the collaboration rather than relaying it.

[![CI](https://github.com/Het-Jethva/TypeSync/actions/workflows/ci.yml/badge.svg)](https://github.com/Het-Jethva/TypeSync/actions/workflows/ci.yml)
![Node 24+](https://img.shields.io/badge/node-24%2B-brightgreen)

**[Live demo →](https://typesync.hetjethva.tech)**

![TypeSync editor with two collaborators editing the same document, each with a named remote cursor](docs/screenshots/editor.png)

<!-- TODO(maintainer): capture docs/screenshots/editor.png — the editor with two
     collaborators' cursors visible. Until this file exists, the image above
     renders as broken alt text on GitHub. -->

TypeSync lets several people edit the same rich-text document at once, with
live cursors and selections, and keeps working when a client goes offline.
The interesting part is not the CRDT — Yjs handles convergence. It is that the
server is an authoritative participant: it re-encodes every awareness frame and
stamps the sender's identity itself so presence cannot be spoofed, rate-limits
document and awareness traffic per socket, re-checks per-document authorization
on both sides of every async load, and owns persistence to PostgreSQL. Clients
propose edits; the server decides what the room sees.

## Tech Stack

| Layer | Technologies |
| --- | --- |
| **Client** | React 19, TipTap, Yjs, Tailwind CSS, Vite |
| **Server** | Express 5, Drizzle ORM, PostgreSQL, Better Auth |
| **Real-time** | Socket.IO + Yjs CRDT sync |
| **Shared** | Zod schemas & TypeScript types |

## Architecture & Engineering Notes

TypeSync is an npm workspaces monorepo with three packages:

- **`client/`** — React SPA with a TipTap rich-text editor, using Yjs for
  conflict-free real-time collaboration. Talks to the server over REST and
  Socket.IO.
- **`server/`** — Express 5 API server handling authentication (Better Auth),
  document persistence (Drizzle ORM + PostgreSQL), and real-time document sync
  (Socket.IO with Yjs).
- **`shared/`** — TypeScript types and Zod schemas shared by both sides.

### How it works

A keystroke in TipTap produces a Yjs update. The **Collaborative Sync Manager**
on the client queues it as a pending batch, merging it into the last unsent
batch when it can (`client/src/lib/sync-manager.ts:101-117`), and emits it with
an acknowledgement timeout — so an update produced while offline is buffered,
not dropped.

On the server, the **Collaborative Room Session** checks that the socket is
actually in the document's room, that its role is `owner` or `editor`, and that
it has a rate-limit token left, then hands the update to the document runtime
(`server/src/socket/room-session.ts:217-268`). The runtime rejects updates over
1 MiB, decodes the update to confirm it is well-formed, runs a size preflight
against a 10 MiB per-document ceiling, applies it to the authoritative `Y.Doc`,
and schedules a debounced write to Postgres
(`server/src/socket/document-runtime.ts:345-386`). The session broadcasts the
accepted update to the rest of the room and acknowledges the sender, whose sync
manager then releases the next batch.

Cursors and selections travel on a separate awareness channel that is never
queued or retried — awareness is ephemeral, so a stale cursor is worse than a
missing one.

### Design decisions

**The server is an authoritative participant, not a relay.** Every awareness
frame is decoded, schema-validated, and re-encoded server-side with the user
identity stamped from the socket's own session
(`server/src/socket/awareness.ts:221-231`). A client cannot claim to be someone
else's cursor. The cost is that the server pays encode/decode on every cursor
move instead of forwarding bytes; the benefit is that presence is trustworthy.

**Persistence is debounced with a max-wait ceiling.** A document is written
after 5s of quiet, but never later than 30s into continuous editing, and a
failed write retries after 15s
(`server/src/socket/document-runtime.ts:50-52`). This bounds both write volume
under sustained typing and the worst-case window of unsaved work.

**Joins are cancellable.** Each `(socket, document)` pair carries a generation
counter (`server/src/socket/room-session.ts:81-94`). Loading a document is
async, and a client can disconnect or rejoin while that load is in flight; the
counter lets the stale join be discarded instead of admitting a socket to a room
it has since left. Authorization is checked on both sides of the load
(`server/src/socket/room-session.ts:154-172`), so access revoked mid-load is
honored.

**Persisted access is authoritative, and access changes reconcile live
sessions.** From `CONTEXT.md`: "A grant, role change, or revocation reconciles
every active connection for that user and Document before publication; a
delivery failure never restores old rights, and a later join re-evaluates
persisted access." A role change that retains access updates connections in
place and preserves awareness; only revocation ends room membership and presence
(`server/src/socket/room-session.ts:299-325`).

**Offline edits are buffered and merged, not dropped.** Pending updates merge
into a single batch while under a 512 KiB cap
(`client/src/lib/sync-manager.ts:101-117`), retries back off exponentially to a
10s ceiling (`client/src/lib/sync-manager.ts:214-222`), and a delivery
generation counter drops acknowledgements from superseded attempts
(`client/src/lib/sync-manager.ts:157-164`). On reconnect the client sends only
the delta the server is missing, computed against the server's state vector.

**Shutdown is a drain, not a kill.** On `SIGTERM`/`SIGINT` the server stops
accepting joins, closes the socket server, waits for in-flight joins to finish,
flushes every dirty document to Postgres, and exits non-zero if any flush failed
(`server/src/index.ts:78-116`). A 30s watchdog forces exit if the drain hangs.

**Document lists use keyset pagination, not `OFFSET`.** Owned and shared
documents are queried separately with the same `(updatedAt, id)` cursor filter
and merged (`server/src/services/document.service.ts:46-99`); cursors are
base64url-encoded opaque strings validated by Zod on the way back in
(`server/src/services/document.service.ts:8-35`). Pagination stays stable while
documents are being reordered by live edits.

### Deliberate constraints

**Run exactly one TypeSync server instance.** This is a decision, not an
oversight. Active Yjs documents, Socket.IO rooms, presence, and update
acknowledgements live in that process, and the architecture does not coordinate
that state between replicas. PostgreSQL stores debounced full-document snapshots
for recovery; it is explicitly not a real-time event bus between servers.

Single-instance matches the current free-tier Render deployment behind
<https://typesync.hetjethva.tech>, where a second
replica would buy nothing. The migration path is known and deliberately
deferred: horizontal scaling requires a shared Socket.IO adapter plus revisiting
which process owns a document's authoritative `Y.Doc` and its persistence. Do
not enable horizontal scaling before doing that work.

**Operations.** Use `GET /api/health` as the dependency-free process liveness
probe. Configure `GET /api/ready` as the routing/readiness target; it returns
200 only when PostgreSQL is reachable.

### Domain model

The vocabulary is written down in [`CONTEXT.md`](CONTEXT.md), which defines the
three concepts this codebase is organized around: the **Collaborative Room
Session** (in-memory per-document session coordinating CRDT edits, rate
limiting, awareness, and persistence), the **Document Access Authorizer** (role
policy for both socket admission and HTTP mutations, plus live reconciliation on
access change), and the **Collaborative Sync Manager** (client-side buffering,
merging, backoff, and delta reconciliation). Each entry records its interface
surface and its semantics. Use those terms when changing the code.

## Prerequisites

- [Node.js](https://nodejs.org/) 24+
- [Docker](https://www.docker.com/) (for PostgreSQL)

## Getting Started

1. **Clone the repository**

   ```bash
   git clone https://github.com/Het-Jethva/TypeSync.git
   cd TypeSync
   ```

2. **Start PostgreSQL**

   ```bash
   docker compose up -d
   ```

3. **Configure environment variables**

   ```bash
   cp .env.example server/.env
   ```

   Edit `server/.env` if you need to change any defaults.

4. **Install dependencies**

   ```bash
   npm install
   ```

5. **Run database migrations**

   ```bash
   npm run db:migrate
   ```

6. **Start development servers**

   ```bash
   npm run dev
   ```

   This starts both the API server (`http://localhost:3000`) and the client dev server (`http://localhost:5173`).

## Available Scripts

All scripts are run from the repository root.

| Script | Description |
| --- | --- |
| `npm run dev` | Start client and server in development mode (concurrently) |
| `npm run dev:server` | Start only the server |
| `npm run dev:client` | Start only the client |
| `npm run build` | Build the shared package, client, and server for production |
| `npm run lint` | Check all workspaces with ESLint |
| `npm run typecheck` | Type-check the shared package, client, and server |
| `npm run db:migrate` | Apply database migrations to PostgreSQL (safe for production). Migrations are version-controlled in `server/drizzle/`. |
| `npm run db:generate` | Generate database migration files from schema changes |
| `npm run db:push` | Push Drizzle schema changes directly (local prototyping only) |
| `npm run db:studio` | Open Drizzle Studio (database GUI) |
| `npm run docker:up` | Start Docker services (PostgreSQL) |
| `npm run docker:down` | Stop Docker services |

## Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://typesync:typesync_dev@localhost:5432/typesync` |
| `BETTER_AUTH_SECRET` | Secret key for Better Auth session signing | **Required — no default.** Generate a unique value per deployment with `openssl rand -base64 32` and never commit it. |
| `BETTER_AUTH_URL` | Public URL of the auth server | `http://localhost:3000` |
| `AUTH_COOKIE_SAME_SITE` | Auth cookie policy: `lax` for same-site deployments or `none` for cross-site HTTPS deployments. Required in production. | `lax` outside production |
| `PORT` | Port the Express server listens on | `3000` |
| `VITE_CLIENT_URL` | Client origin, used by the server for CORS and trusted origins | `http://localhost:5173` |

For the production setup with the client on Vercel and the API on Render, set
`AUTH_COOKIE_SAME_SITE=none`. The API must be served over HTTPS when this value
is used.

## Project Structure

```
TypeSync/
├── client/             # React + Vite frontend
│   ├── src/
│   │   ├── components/ # UI components
│   │   ├── lib/hooks/  # Custom React hooks
│   │   ├── lib/        # Utilities & API client
│   │   └── pages/      # Route pages
│   └── package.json
├── server/             # Express 5 backend
│   ├── src/
│   │   ├── db/         # Drizzle schema & connection
│   │   ├── routes/     # API route handlers
│   │   └── index.ts    # Server entry point
│   └── package.json
├── shared/             # Shared types & schemas
│   ├── types.ts
│   └── package.json
├── docs/screenshots/   # README images
├── docker-compose.yml  # PostgreSQL service
├── .env.example        # Environment variable template
└── package.json        # Root workspace config
```
