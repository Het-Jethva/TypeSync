# TypeSync agent guide

## Architecture

- This is an npm-workspaces monorepo: `client/`, `server/`, and `shared/`.
- `client/src/pages` owns routes; `client/src/components` owns UI; `client/src/lib` owns API, auth, sockets, theme, and hooks.
- `server/src/routes` owns HTTP handlers, `server/src/services` owns domain operations, `server/src/db` owns Drizzle schema/connection, and `server/src/socket` owns Socket.IO/Yjs collaboration.
- `shared/types.ts` is the source of shared Zod schemas and TypeScript event/result types. Keep client/server event shapes synchronized there.
- The server is intentionally single-instance: in-memory Yjs documents, rooms, presence, and acknowledgements are not coordinated between replicas.

## Commands

Run from the repository root (Node.js 24+):

```text
npm install
npm run dev
npm run typecheck
npm run typecheck:client
npm run typecheck:server
npm run lint
npm run build
npm run db:generate
npm run db:migrate
npm run db:push       # local prototyping only
npm run db:studio
```

See `README.md` for Docker, environment setup, health/readiness routes, and deployment details. Never copy environment values, credentials, cookies, or secrets into source or documentation.

## Verification

The repository has an explicit maintainer decision not to add automated tests or CI. Do not introduce test frameworks, test files, or CI unless that decision is reversed. Every change still requires typecheck, lint with zero warnings, production build, targeted static checks, and the plan's named manual scenarios. Keep changes scoped to the active plan.

## TypeScript and UI conventions

- Use strict TypeScript and type imports where appropriate. Follow existing local style and ESLint; do not add `any` when a useful type exists.
- Validate untrusted input at HTTP/socket boundaries with the existing Zod schemas. Preserve safe, user-facing error messages; do not expose raw response bodies, database errors, or stack traces.
- Authenticate and authorize every protected API and socket operation. Preserve the existing Better Auth session checks and document-role checks.
- Use semantic HTML, accessible names for controls, visible keyboard focus, and reduced-motion behavior. Keep design tokens centralized in `client/src/index.css`.
- Reuse existing async request-generation refs, cleanup, and retry patterns. Do not let stale responses update route or document state.
- Representative client patterns: `client/src/pages/DashboardPage.tsx`, `client/src/lib/hooks/useCollaborativeDocument.ts`, and `client/src/components/ShareModal.tsx`.

## Realtime

- A document must pass session validation and access checks before joining. Load from PostgreSQL before joining, then perform the final access/generation check.
- Capture the final Yjs join snapshot synchronously immediately before `socket.join` and acknowledgement; do not await between snapshot and join/ack.
- Keep Y.Doc, awareness storage/codecs, timers, ownership maps, and persistence state behind their deep module interfaces in `server/src/socket/`.
- Awareness input is one-client-per-frame, size/rate limited, monotonic, ownership checked, and sanitized with server-owned identity before broadcast or snapshot storage. Cleanup must remove bindings, ownership, and stored states together.
- Document updates remain role-checked, rate limited, size limited, acknowledged, and retriable. Preserve the exact 10 MiB hard limit and bounded CPU work.
- Persistence uses debounced full snapshots with retry and flush-on-eviction/shutdown. Do not change persistence timing casually.

## Database

- Edit the Drizzle schema in `server/src/db/schema.ts`, then use `npm run db:generate` to create a version-controlled migration in `server/drizzle/`. Review generated SQL, rehearse/backup production data for destructive or type-changing migrations, then apply with `npm run db:migrate`.
- `db:push` is for local prototyping only; do not use it as the production migration workflow.
- Database instants should be stored as timezone-aware PostgreSQL timestamps and converted at presentation boundaries.

## Plans

- Execute plans in `plans/README.md` order, one thin vertical slice at a time. Read the full plan, run its drift check before editing, honor STOP conditions, and run every verification gate and manual scenario.
- Update only the active plan's status row after review. Use `TODO`, `IN PROGRESS`, `DONE`, `BLOCKED` with a reason, or `REJECTED` with a rationale.
- Do not add unrelated cleanup, dependencies, tests, or source changes outside the active plan's scope. Keep plan files as planning artifacts rather than implementation code.

## Security

Never read, reproduce, print, commit, or request secrets from `.env` files, auth cookies, database credentials, session tokens, or production logs. Use `.env.example` and redacted error output when documenting setup. Treat all client input, HTTP payloads, socket frames, and database content as untrusted.
