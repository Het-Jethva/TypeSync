# TypeSync

TypeSync is a real-time collaborative document editor. It works like a small Google Docs clone with shared editing, live presence, and role based sharing.

## Features

- **Real-time editing.** Multiple people edit one document at once. The client uses TipTap on top of Yjs. The server relays Yjs updates over Socket.IO.
- **Live presence.** You see who else is in the document. Awareness updates flow through `awareness:update`.
- **Roles that mean something.** Each user has one role per document. Owners manage access. Editors write. Viewers read. The checks live in `shared/types.ts`.
- **Sharing UI.** The dashboard has a share modal with editor and viewer invites by email.
- **Document dashboard.** You can create, search, sort, and page through documents. The list API supports `q`, `sort`, `cursor`, and `limit`.
- **Rich text blocks.** The editor supports tables, task lists, images, code blocks, underline, and slash menu inserts.
- **Auth included.** Sign in uses better-auth with session cookies.
- **Persistence that survives restarts.** Yjs state flushes to PostgreSQL. Shutdown drains rooms and saves before exit.
- **Guards for production use.** The API uses rate limits, size limits for updates and documents, CORS with credentials, and readiness probes at `/api/ready`.

## Tech stack

- Client in `client/`. React 19, Vite, React Router 8, Tailwind CSS 4, TipTap 3, Yjs, Socket.IO client, better-auth, Zod.
- Server in `server/`. Node 24, Express 5, Socket.IO, Yjs, Drizzle ORM, PostgreSQL 17, better-auth, Zod.
- Shared contract in `shared/`. Zod schemas and Socket.IO event types in `shared/types.ts`.
- Infra. Docker Compose for Postgres. Multi-stage `Dockerfile` for the server. `client/vercel.json` rewrites SPA routes to `index.html`.

## Architecture

The client talks to one server over two channels.

- REST at `/api/documents` for create, list, rename, delete, and collaborators.
- Socket.IO for `doc:join`, `doc:update`, `awareness:update`, and `doc:leave`.
- The server keeps each open document in a `CollaborativeRoomSession`.
- The session persists Yjs binary state to the `document` table.
- Auth state comes from better-auth. Document access checks run before room join and before each update.

A simplified flow looks like this.

- You open `/document/:id`.
- The client joins the room with `doc:join`.
- The server returns the current Yjs state, your role, and a unique runtime epoch.
- Edits send binary updates with `doc:update`.
- Other clients receive `doc:update` and presence through `awareness:update`.

## Quickstart

You need Node 24 or later, npm, and Docker.

1. Install dependencies.

```bash
npm install
```

2. Start Postgres.

```bash
docker compose up -d
```

3. Copy the server env file and edit the values.

```bash
cp server/.env.example server/.env
```

4. Push the schema to the database.

```bash
npm run db:push -w server
```

5. Run the app in dev mode.

```bash
npm run dev
```

Open the client at `http://localhost:5173`. The API runs at `http://localhost:3000`. Vite proxies `/api` and `/socket.io` to the server in dev.

## Environment variables

The server reads these values from `server/.env`. See `server/.env.example` for a starter file. See `server/src/config.ts` for validation.

- `DATABASE_URL`. Postgres connection string.
- `BETTER_AUTH_SECRET`. Random string with at least 32 characters.
- `BETTER_AUTH_URL`. Public URL of the server. Use `http://localhost:3000` for dev.
- `VITE_CLIENT_URL`. Client origin used for CORS and auth origins. Use `http://localhost:5173` for dev.
- `PORT`. Server port. Defaults to 3000.
- `NODE_ENV`. Set to `production` for strict config checks.
- `AUTH_COOKIE_SAME_SITE`. Use `lax` or `none`.

## Scripts

Run these from the repo root.

- `npm run dev`. Build shared types, then run server and client together.
- `npm run build`. Build shared, client, and server.
- `npm run check`. Run lint, typecheck, regression tests, and build.
- `npm test`. Run the four collaboration regression tests using real Yjs documents.
- `npm run lint`. Run ESLint with zero warnings allowed.
- `npm run typecheck`. Typecheck shared, client, and server.
- `npm run db:push -w server`. Push Drizzle schema to Postgres.
- `npm run db:studio -w server`. Open Drizzle Studio.
- `npm run db:generate -w server`. Generate migrations from the schema.
- `npm run db:migrate -w server`. Apply generated migrations.
- `npm run docker:up`. Start Postgres in the background.
- `npm run docker:down`. Stop Postgres.

## Project structure

- `client/src/pages/`. Landing, auth, and dashboard routes.
- `client/src/components/Editor.tsx`. TipTap editor bound to Yjs.
- `client/src/components/ShareModal.tsx`. Collaborator invites and role changes.
- `client/src/components/Sidebar.tsx`. Document list and search.
- `server/src/index.ts`. Express app, Socket.IO setup, health checks, shutdown.
- `server/src/routes/documents.ts`. Document REST API.
- `server/src/socket/room-session.ts`. In-memory Yjs rooms and persistence.
- `server/src/db/schema.ts`. Drizzle tables for users, documents, and collaborators.
- `shared/types.ts`. Roles, document shapes, list queries, and socket events.
