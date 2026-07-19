# Plan 005: Add a PostgreSQL-aware readiness probe

> **Executor instructions**: Preserve the cheap liveness endpoint and add readiness as a thin server/documentation slice. Do not add tests. Update the index.
>
> **Drift check (run first)**: `git diff --stat 77bd4fc..HEAD -- server/src/index.ts server/src/db/index.ts README.md`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `77bd4fc`, 2026-07-19

## Why this matters

`/api/health` always returns 200, even when the database required by auth and documents is unavailable. Keep it as a process liveness check and add `/api/ready`, which returns 200 only when PostgreSQL answers a bounded probe. Deployment systems can then distinguish restart-worthy process failure from temporary dependency unavailability.

## Current state

- `server/src/index.ts:32-35` implements unconditional health.
- `server/src/db/index.ts:6-12` exports the `pg.Pool`.
- Express async errors elsewhere use `asyncHandler`, but readiness needs a deliberate `503` response rather than the generic 500 handler.

## Commands

`npm run typecheck`, `npm run lint`, `npm run build` → exit 0.

## Scope

**In scope**: `server/src/index.ts`, `README.md`.

**Out of scope**: Docker healthchecks, hosting-provider configuration not present in the repo, schema checks, migrations, tests, new dependencies.

## Git workflow

Branch `advisor/005-add-readiness-probe`; commit `fix(server): expose database readiness`.

## Steps

1. Keep `GET /api/health` unchanged as liveness. Add `GET /api/ready`; run `pool.query("select 1")`, return `{status:"ready", timestamp}` with 200 on success, and `{status:"not_ready", timestamp}` with 503 on failure. Do not include the database error or connection details in the response. Log only a concise readiness failure without credential/config values.
   - **Verify**: `npm run typecheck && npm run lint` → exit 0.
2. Add a short README deployment note defining `/api/health` as liveness and `/api/ready` as the routing/readiness target.
   - **Verify**: `rg -n '/api/health|/api/ready' README.md server/src/index.ts` → both endpoints documented and implemented.
3. With PostgreSQL running, `curl -fsS http://localhost:3000/api/ready` must return JSON with `status: ready`. With PostgreSQL unavailable, `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/ready` must print `503`, while `/api/health` remains 200.
   - **Verify**: `npm run build` → exit 0.

## Test plan

No automated tests. Use the two manual dependency-state checks in step 3.

## Done criteria

- [ ] Liveness is dependency-free.
- [ ] Readiness returns 200/503 according to database reachability.
- [ ] Responses never expose database errors or configuration.
- [ ] README identifies the deployment target.
- [ ] Standard gates pass.

## STOP conditions

STOP if a hosting configuration appears that already relies on `/api/health` for readiness; report it so migration can be coordinated rather than silently changing semantics.

## Maintenance notes

Readiness should stay cheap and bounded. Add other dependencies only if they are mandatory for serving requests.
