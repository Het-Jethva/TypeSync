# Plan 006: Paginate the document library end to end

> **Executor instructions**: Implement one complete server/shared/client pagination slice. Do not add tests. Run every gate and update the index.
>
> **Drift check (run first)**: `git diff --stat 77bd4fc..HEAD -- shared/types.ts server/src/routes/documents.ts server/src/services/document.service.ts client/src/lib/api.ts client/src/pages/DashboardPage.tsx client/src/components/Sidebar.tsx`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/003-order-document-refreshes.md`
- **Category**: perf
- **Planned at**: commit `77bd4fc`, 2026-07-19

## Why this matters

The list endpoint returns every owned/shared document and sorts the combined result in memory. The dashboard refetches that unbounded payload after common actions. This slice introduces stable cursor pagination and a Load more affordance while preserving the existing document cards and local sorting for loaded items.

## Current state

- `server/src/services/document.service.ts:44-78` runs two unbounded queries and sorts their union.
- `server/src/routes/documents.ts:40-47` accepts no list query.
- `client/src/lib/api.ts:38-39` expects `DocumentWithRole[]`.
- `DashboardPage` stores a flat array; `Sidebar` filters/sorts it locally.
- Shared request validation uses Zod and inferred types (`shared/types.ts:114-129`). Match that convention.

## Commands

`npm run typecheck`, `npm run lint`, `npm run build` → exit 0.

## Scope

**In scope**: `shared/types.ts`, `server/src/routes/documents.ts`, `server/src/services/document.service.ts`, `client/src/lib/api.ts`, `client/src/pages/DashboardPage.tsx`, `client/src/components/Sidebar.tsx`.

**Out of scope**: full-text server search, changing sort controls, infinite-scroll dependencies, database migrations, tests.

## Git workflow

Branch `advisor/006-paginate-document-library`; commit `perf(documents): paginate library results`.

## Steps

1. In `shared/types.ts`, add a Zod list-query schema with optional cursor and integer `limit` bounded 1–100, default 50. Define a response type `{ items: DocumentWithRole[]; nextCursor: string | null }`. Cursor is opaque to clients.
   - **Verify**: `npm run typecheck -w shared` → exit 0.
2. In `DocumentService.listUserDocuments`, accept parsed pagination input. Use stable descending `(updatedAt,id)` ordering and cursor filtering in both owned/shared queries; fetch `limit + 1` from each, merge and sort, return the first `limit`, and derive `nextCursor` from the last returned item only when more merged rows exist. Encode/decode cursor in a private helper using an ISO timestamp plus UUID; malformed cursors must become a 400 validation/operational error, never a 500. Do not use offset pagination.
   - **Verify**: `npm run typecheck:server` → exit 0.
3. Parse `req.query` in the GET route with the shared schema and return the page object. Update `client/src/lib/api.ts` so `list` accepts optional cursor/limit, uses `URLSearchParams`, and expects the page response.
   - **Verify**: `npm run typecheck` → exit 0.
4. Update `DashboardPage`: authoritative refresh replaces items and cursor; Load more appends de-duplicated items by ID and advances the cursor. Keep the request-generation rule from plan 003, but distinguish refresh ownership from append ownership so a stale page cannot append after a refresh. Reset pagination after create/delete/rename/permission changes.
   - **Verify**: `npm run lint` → exit 0.
5. Add `hasMore`/`onLoadMore`/`isLoadingMore` props to `Sidebar` and render a disabled/loading-aware “Load more” button after loaded document rows when `nextCursor` exists. Search and sort continue to apply to loaded items; label the search placeholder `Search loaded documents…` while more pages exist.
   - **Verify**: `npm run build` → exit 0.

## Test plan

No automated tests. Manually seed more than 50 mixed owned/shared documents with duplicate timestamps. Verify no duplicate/missing IDs across pages, deterministic order after refresh, permission removal resets pages, and malformed cursor returns 400.

## Done criteria

- [ ] Endpoint returns at most requested limit and an opaque next cursor.
- [ ] Ordering is stable on `updatedAt` plus `id`.
- [ ] Client refresh replaces; load-more de-duplicates/appends.
- [ ] Stale page requests cannot append after refresh.
- [ ] Existing sort controls operate on loaded items and partial search is disclosed.
- [ ] Standard gates pass.

## STOP conditions

STOP if Drizzle cannot express identical cursor predicates for both queries without raw interpolated SQL, if legacy data can contain the same user as owner and collaborator, or if product requires search/sort across the entire server-side collection now. Report instead of inventing a broader API.

## Maintenance notes

Server-side search/sort is the natural follow-up if users routinely exceed one page. Review cursor encoding as untrusted input and never interpolate decoded values into SQL.
