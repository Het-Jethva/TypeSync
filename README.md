# TypeSync

Real-time collaborative document editor.

## Tech Stack

| Layer | Technologies |
| --- | --- |
| **Client** | React 19, TipTap, Yjs, Tailwind CSS, Vite |
| **Server** | Express 5, Drizzle ORM, PostgreSQL, Better Auth |
| **Real-time** | Socket.IO + Yjs CRDT sync |
| **Shared** | Zod schemas & TypeScript types |

## Architecture

TypeSync is organized as an npm workspaces monorepo with three packages:

- **`client/`** — React SPA with TipTap rich-text editor, using Yjs for conflict-free real-time collaboration. Communicates with the server via REST API and Socket.IO.
- **`server/`** — Express 5 API server handling authentication (Better Auth), document persistence (Drizzle ORM + PostgreSQL), and real-time document sync (Socket.IO with Yjs).
- **`shared/`** — Common TypeScript types and Zod validation schemas shared between client and server.

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
| `BETTER_AUTH_SECRET` | Secret key for Better Auth session signing | `your-secret-key-change-in-production` |
| `BETTER_AUTH_URL` | Public URL of the auth server | `http://localhost:3000` |
| `AUTH_COOKIE_SAME_SITE` | Auth cookie policy: `lax` for same-site deployments or `none` for cross-site HTTPS deployments. Required in production. | `lax` outside production |
| `PORT` | Port the Express server listens on | `3000` |
| `VITE_CLIENT_URL` | Client origin, used by the server for CORS and trusted origins | `http://localhost:5173` |

For the production setup with the client on Vercel and the API on Render, set
`AUTH_COOKIE_SAME_SITE=none`. The API must be served over HTTPS when this value
is used.

## Deployment Constraints

Run exactly one TypeSync server instance. Active Yjs documents, Socket.IO rooms,
presence, and update acknowledgements are held in that process; the current
architecture does not coordinate this state between replicas. PostgreSQL stores
debounced full-document snapshots for recovery, but it is not a real-time event
bus between servers.

This single-instance constraint matches the current free Render deployment. Do
not enable horizontal scaling without first adding shared real-time coordination
and revisiting document persistence.

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
├── docker-compose.yml  # PostgreSQL service
├── .env.example        # Environment variable template
└── package.json        # Root workspace config
```
