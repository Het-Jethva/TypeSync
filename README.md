# TypeSync

TypeSync is a deployed collaborative rich-text editor built to explore the
hard parts of real-time document systems: convergent editing, authenticated
room membership, live authorization changes, reconnect recovery, ephemeral
presence, and honest persistence semantics.

**[Open the live demo](https://typesync.hetjethva.tech)**

The frontend wakes the free Render backend when the page opens. A cold start
can take tens of seconds; the interface reports whether the backend is waking,
delayed, ready, or unavailable and retries automatically.

## Engineering case study

The editor binds TipTap to a client-side Yjs document. Local Yjs updates travel
over Socket.IO to a server-owned Yjs document for the active room. Because Yjs
updates are commutative and idempotent, collaborators can edit concurrently
and converge without ordering every keystroke through the database.

The collaboration protocol is deliberately more restrictive than a raw Yjs
relay:

- Every socket authenticates with a Better Auth session cookie and may join
  only documents the server authorizes from PostgreSQL.
- The server records the role for each socket and room. Owners and editors may
  submit document updates; viewers receive document and presence updates but
  cannot edit. Role changes are applied to active sessions, and revocation
  removes the user's sockets from the room immediately.
- Awareness is a separate, volatile channel. The server validates cursor
  payloads, binds one awareness client ID to its socket, replaces client-sent
  identity with the authenticated user's name and ID, rejects frames over
  16 KiB, and rate-limits presence updates to 20 per second with a burst of 40.
  Presence is neither queued for retry nor stored in PostgreSQL.
- Document updates are also rate-limited and size-checked before the server
  applies and broadcasts them.

### Architecture

```mermaid
flowchart LR
    Browser["Browser<br/>React, TipTap, Yjs"] -->|"loads static app"| Vercel["Vercel<br/>frontend"]
    Browser <-->|"HTTPS API + authenticated Socket.IO"| Render["Render<br/>Express + Socket.IO"]
    Render <--> Runtime["In-memory Yjs rooms<br/>single server process"]
    Render <-->|"auth, metadata, access"| Postgres[("PostgreSQL")]
    Runtime <-->|"load + bounded snapshot flush"| Postgres
```

Vercel serves the Vite application; the browser talks directly to the Render
API. Render owns authenticated HTTP routes, Socket.IO rooms, and the in-memory
Yjs runtime. PostgreSQL stores accounts, sessions, document metadata, access
roles, and encoded Yjs snapshots.

### Reconnect and sync semantics

Edits made while the socket is disconnected remain in the Yjs document and
pending-update queue of the same mounted browser tab. After reconnecting, the
client rejoins the authenticated room, applies the server snapshot, compares
against the server state vector, and sends the missing Yjs delta with
acknowledged retries.

This recovery is intentionally scoped to a same-tab reconnect. Pending edits
are not written to IndexedDB or another browser store, so closing or reloading
the tab can discard edits that have not reached the server.

The UI reports an update as **Synced** only after the server accepts it into
the active room. That acknowledgement is not an immediate durable database
save. The server persists a full Yjs snapshot after 5 seconds of inactivity,
forces a flush after at most 30 seconds of continuous changes, retries failed
saves after 15 seconds, and flushes when the last collaborator leaves or the
process shuts down gracefully. A crash between an acknowledgement and the
next successful snapshot can therefore lose the newest accepted updates.

Persistence is bounded in size as well as time: individual updates are capped
at 1 MiB, clients receive a warning when encoded document state reaches 8 MiB,
and updates that would push it beyond 10 MiB are rejected.

### Deliberate deployment tradeoff

TypeSync intentionally runs one collaboration server. Active Yjs documents,
room membership, awareness state, and rate-limit buckets live in that process,
using Socket.IO's in-memory adapter. This keeps the deployed portfolio project
small and makes one server authoritative for each accepted update.

It also means the current design must not be horizontally replicated:
independent instances would hold different room state and could race when
writing snapshots. Multi-server operation would require explicit document
ownership or shared collaboration coordination in addition to cross-instance
Socket.IO fan-out.

The free Render service may suspend while idle. The frontend probes
`/api/ready`, waits for both the API and database, retries during the cold
start, and prevents authentication attempts until the backend is ready. This
is an intentional demo constraint rather than hidden loading latency.

## Stack

| Area | Implementation |
| --- | --- |
| Editor | React 19, TypeScript, TipTap |
| Collaboration | Yjs, Yjs awareness, Socket.IO |
| Server | Node.js 24, Express 5 |
| Data and auth | PostgreSQL, Drizzle ORM, Better Auth |
| Deployment | Vercel frontend, Render container backend |

## Run locally

Requirements: Node.js 24 or later and Docker with Compose.

```bash
git clone https://github.com/Het-Jethva/TypeSync.git
cd TypeSync
npm install
docker compose up -d
```

Create `server/.env` with the local PostgreSQL credentials from
`docker-compose.yml`:

```dotenv
DATABASE_URL=postgresql://typesync:typesync_dev@localhost:5432/typesync
BETTER_AUTH_SECRET=replace-this-with-a-random-secret-at-least-32-characters
BETTER_AUTH_URL=http://localhost:3000
VITE_CLIENT_URL=http://localhost:5173
AUTH_COOKIE_SAME_SITE=lax
PORT=3000
NODE_ENV=development
```

Apply the checked-in Drizzle migrations and start both workspaces:

```bash
npm run db:migrate
npm run dev
```

The Vite client runs at <http://localhost:5173> and proxies `/api` and
`/socket.io` to the server at <http://localhost:3000>. No client environment
file is needed for this standard local setup.

## Environment variables

### Server (`server/.env` locally, Render in production)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection URL. Required in production and for database-backed local commands. |
| `BETTER_AUTH_SECRET` | Better Auth signing secret. Production requires at least 32 characters and rejects the documented placeholder. |
| `BETTER_AUTH_URL` | Public origin of the backend, for example `http://localhost:3000`. Required in production. |
| `VITE_CLIENT_URL` | Public frontend origin allowed by CORS, Socket.IO origin checks, and Better Auth. Defaults to `http://localhost:5173` in development and is required in production. |
| `AUTH_COOKIE_SAME_SITE` | `lax` or `none`. Use `lax` locally; the cross-origin Vercel-to-Render deployment uses `none` with secure cookies. Required in production. |
| `PORT` | HTTP server port; defaults to `3000`. |
| `NODE_ENV` | Set to `production` to enable strict production configuration validation and production cookie behavior. |

### Client (`client/.env` or Vercel build environment)

| Variable | Purpose |
| --- | --- |
| `VITE_API_URL` | Public backend origin used by HTTP, auth, readiness, and Socket.IO clients. Omit it locally to use the Vite proxy; set it to the Render service origin for the Vercel build. |

Vite embeds `VITE_API_URL` at build time. Do not append `/api`; the client adds
the API paths itself.

## Repository commands

```bash
npm run dev          # start client and server development processes
npm run db:migrate   # apply checked-in Drizzle migrations
npm run lint
npm run typecheck
npm run build
```

For a deeper description of the collaboration modules and domain terminology,
see [CONTEXT.md](CONTEXT.md).
