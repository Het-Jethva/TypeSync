# Plan 003: Prevent stale document-list refreshes

> **Executor instructions**: Implement only this client slice. Do not add tests. Update the status index when done.
>
> **Drift check (run first)**: `git diff --stat 77bd4fc..HEAD -- client/src/pages/DashboardPage.tsx`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `77bd4fc`, 2026-07-19

## Why this matters

`fetchDocuments` can run concurrently from initial load, permission events, and mutations. An older response may arrive last and overwrite newer document/permission state. A monotonic request generation lets only the newest refresh update React state while preserving all existing callers.

## Current state

- `client/src/pages/DashboardPage.tsx:84-103` applies every response/error/finally block.
- Calls originate at `:106`, `:120`, `:129`, `:170`, `:187`, and `:203`.
- The file already uses refs for cross-render coordination (`hasLoadedDocumentsRef`, `bypassNextNavigationRef`). Match that pattern.

## Commands

`npm run typecheck`, `npm run lint`, `npm run build` → exit 0.

## Scope

**In scope**: `client/src/pages/DashboardPage.tsx`.

**Out of scope**: API cancellation plumbing, React Query/SWR, pagination, optimistic mutation redesign, tests.

## Git workflow

Branch `advisor/003-order-document-refreshes`; commit `fix(client): ignore stale document refreshes`.

## Steps

1. Add a numeric `documentsRequestGenerationRef`. At the start of each `fetchDocuments` call, increment it and capture the generation locally.
   - **Verify**: `npm run typecheck` → exit 0.
2. Before every state mutation in the success, catch, and finally paths, require that the local generation still equals the current generation. An old request must not set documents, errors, notifications, loading state, or `hasLoadedDocumentsRef`. Keep `fetchDocuments`'s `Promise<void>` behavior so mutation callers can continue awaiting it.
   - **Verify**: `npm run lint` → exit 0.
3. Ensure permission handlers retain their immediate local update before starting the authoritative refresh.
   - **Verify**: `npm run build` → exit 0.

## Test plan

No automated tests. For manual verification, throttle `/api/documents`, trigger two refreshes around a rename or permission update, and confirm the latest response wins without duplicate stale-error notifications.

## Done criteria

- [ ] Only the newest request generation mutates document-list state.
- [ ] Existing call sites retain their signatures and behavior.
- [ ] Permission events still update immediately.
- [ ] Standard gates pass.

## STOP conditions

STOP if the solution requires changing `client/src/lib/api.ts`, adding a data-fetching dependency, or suppressing all refresh errors rather than only stale ones.

## Maintenance notes

Pagination later must either retain this generation guard or replace it with query-key/cursor-aware request ownership.
