# TypeSync

TypeSync is a deployed collaborative rich-text editor. I built it to work
through the parts of real-time document systems that are actually hard:
convergent editing, authenticated room membership, live authorization changes,
reconnect recovery, ephemeral presence, and persistence semantics that don't
lie to the user.

**[Open the live demo](https://typesync.hetjethva.tech)**

The frontend wakes the free Render backend when the page opens. A cold start
can take tens of seconds. The interface says whether the backend is waking,
delayed, ready, or unavailable, and it retries on its own.

## Engineering case study

The editor binds TipTap to a client-side Yjs document. Local Yjs updates travel
over Socket.IO to a server-owned Yjs document for the active room. Yjs updates
are commutative and idempotent, so collaborators can edit at the same time and
converge without pushing every keystroke through the database.

The collaboration protocol is stricter than a raw Yjs relay:

- Every socket authenticates with a Better Auth session cookie and can join
  only the documents the server authorizes from PostgreSQL.
- The server records a role per socket and room. Owners and editors may submit
  document updates. Viewers get document and presence updates but cannot edit.
  A role change hits live sessions, and revoking access drops the user's
  sockets from the room right away.
- Awareness is a separate, volatile channel. The server validates cursor
  payloads, binds one awareness client ID to its socket, replaces client-sent
  identity with the authenticated user's name and ID, rejects frames over
  16 KiB, and rate-limits presence to 20 updates per second with a burst of 40.
  Nothing about presence is queued for retry or written to PostgreSQL.
- Document updates get the same treatment. The server rate-limits and
  size-checks them before it applies and broadcasts them.

### Architecture

```mermaid
flowchart LR
    Browser["Browser<br/>React, TipTap, Yjs"] -->|"loads static app"| Vercel["Vercel<br/>frontend"]
    Browser <-->|"HTTPS API + authenticated Socket.IO"| Render["Render<br/>Express + Socket.IO"]
    Render <--> Runtime["In-memory Yjs rooms<br/>single server process"]
    Render <-->|"auth, metadata, access"| Postgres[("PostgreSQL")]
    Runtime <-->|"load + bounded snapshot flush"| Postgres
```

Vercel serves the Vite application, and the browser talks straight to the
Render API. Render owns the authenticated HTTP routes, the Socket.IO rooms, and
the in-memory Yjs runtime. PostgreSQL holds accounts, sessions, document
metadata, access roles, and encoded Yjs snapshots.

### Reconnect and sync semantics

Edits you make while the socket is down stay in the Yjs document and the
pending-update queue of that same mounted browser tab. On reconnect the client
rejoins the authenticated room, applies the server snapshot, compares it
against the server state vector, and sends the missing Yjs delta with
acknowledged retries.

That recovery covers a same-tab reconnect and nothing more. Pending edits never
reach IndexedDB or any other browser store, so closing or reloading the tab can
throw away edits the server never saw.

The UI shows **Synced** once the server accepts an update into the active room.
That acknowledgement is not a durable database write. The server writes a full
Yjs snapshot after 5 seconds of quiet, forces a flush after at most 30 seconds
of continuous changes, retries a failed save after 15 seconds, and flushes when
the last collaborator leaves or when the process shuts down cleanly. A crash
between an acknowledgement and the next good snapshot loses the newest accepted
updates. I would rather say that here than let the checkmark imply more than it
means.

Size has limits too. One update caps at 1 MiB, clients get a warning when
encoded document state reaches 8 MiB, and the server rejects updates that would
push it past 10 MiB.

### The one-server tradeoff

TypeSync runs a single collaboration server on purpose. Active Yjs documents,
room membership, awareness state, and rate-limit buckets all live in that one
process, on Socket.IO's in-memory adapter. It keeps a portfolio deployment
small, and it makes exactly one server authoritative for each accepted update.

The cost is that you must not replicate this design horizontally. Separate
instances would hold different room state and could race each other writing
snapshots. Running more than one server needs explicit document ownership or
shared collaboration coordination, on top of cross-instance Socket.IO fan-out.

The free Render service can suspend while idle. The frontend probes
`/api/ready`, waits for the API and the database, retries through the cold
start, and blocks sign-in attempts until the backend answers. That is a demo
constraint I chose to show rather than hide behind a spinner.

## Stack

| Area | Implementation |
| --- | --- |
| Editor | React 19, TypeScript, TipTap |
| Collaboration | Yjs, Yjs awareness, Socket.IO |
| Server | Node.js 24, Express 5 |
| Data and auth | PostgreSQL, Drizzle ORM, Better Auth |
| Deployment | Vercel frontend, Render container backend |

## Run locally

You need Node.js 24 or later and Docker with Compose.

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

Apply the checked-in Drizzle migrations, then start both workspaces:

```bash
npm run db:migrate
npm run dev
```

The Vite client runs at <http://localhost:5173> and proxies `/api` and
`/socket.io` to the server at <http://localhost:3000>. A standard local setup
needs no client environment file.

## Environment variables

### Server (`server/.env` locally, Render in production)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection URL. Required in production and for database-backed local commands. |
| `BETTER_AUTH_SECRET` | Better Auth signing secret. Production wants at least 32 characters and rejects the placeholder above. |
| `BETTER_AUTH_URL` | Public origin of the backend, such as `http://localhost:3000`. Required in production. |
| `VITE_CLIENT_URL` | Public frontend origin that CORS, the Socket.IO origin check, and Better Auth allow. Defaults to `http://localhost:5173` in development. Required in production. |
| `AUTH_COOKIE_SAME_SITE` | `lax` or `none`. Use `lax` locally. The cross-origin Vercel-to-Render deployment uses `none` with secure cookies. Required in production. |
| `PORT` | HTTP server port. Defaults to `3000`. |
| `NODE_ENV` | Set it to `production` for strict config validation and production cookie behavior. |

### Client (`client/.env` or Vercel build environment)

| Variable | Purpose |
| --- | --- |
| `VITE_API_URL` | Public backend origin for the HTTP, auth, readiness, and Socket.IO clients. Leave it unset locally to use the Vite proxy. Point it at the Render service origin for the Vercel build. |

Vite embeds `VITE_API_URL` at build time. Do not append `/api`, because the
client adds the API paths itself.

## Repository commands

```bash
npm run dev          # start client and server development processes
npm run db:migrate   # apply checked-in Drizzle migrations
npm run lint
npm run typecheck
npm run build
```

[CONTEXT.md](CONTEXT.md) goes deeper on the collaboration modules and the
domain terminology.
