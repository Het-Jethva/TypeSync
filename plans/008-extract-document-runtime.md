# Plan 008: Encapsulate collaborative document lifecycle behind one deep module

> **Executor instructions**: Perform a behavior-preserving extraction after plan 007. Do not add tests. Keep each step buildable and run the manual collaboration matrix before marking done.
>
> **Drift check (run first)**: `git diff --stat 77bd4fc..HEAD -- server/src/socket/index.ts server/src/socket/document-runtime.ts server/src/socket/types.ts server/src/index.ts`
> Because plan 007 intentionally changes `index.ts`, compare symbols and invariants rather than expecting the original file layout. STOP if persistence semantics differ from the Current state.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/007-extract-awareness-module.md`
- **Category**: tech-debt
- **Planned at**: commit `77bd4fc`, 2026-07-19

## Why this matters

Document loading, Yjs state, size accounting, debounced/max-wait persistence, retry, eviction, deletion, and shutdown flushing are implemented alongside socket transport. This slice creates a deep document-runtime module whose small interface hides those lifecycle invariants. Socket handlers remain responsible for sessions, authorization, room membership, acknowledgements, and broadcasts.

## Current state

- Runtime maps/state: `server/src/socket/index.ts:52-79`.
- Size/load/persistence implementation: `:337-610`.
- Shutdown flush: `:615-643`.
- Deletion combines room orchestration and runtime destruction at `:687-725`.
- Join calls `getOrCreateDoc`/`ensureDocLoaded` and encodes state at `:830-872`.
- Update preflights, applies, schedules persistence at `:927-1016`.
- Required invariants: one in-memory Y.Doc per ID; one concurrent load; DB state loaded before room join; 5s debounce/30s max wait/15s retry; serialized saves; dirty restoration on failure; 1 MiB update/10 MiB document limits with 8 MiB warning; save-before-evict and room recheck; shutdown reports failed IDs; deletion cancels persistence and destroys state.

## Commands

`npm run typecheck:server`, `npm run lint`, `npm run build` → exit 0.

## Suggested executor toolkit

Use `codebase-design`: the runtime interface is a seam with concrete PostgreSQL/Yjs implementation. Do not invent a storage port—there is one adapter and no test adapter by explicit policy.

## Scope

**In scope**: create `server/src/socket/document-runtime.ts`; modify `server/src/socket/index.ts`; modify `server/src/socket/types.ts` only if a shared socket-server alias is needed; keep `server/src/index.ts` source-compatible unless an import path must change.

**Out of scope**: algorithms/timing/limits, database schema, event contracts, authorization, awareness, horizontal scaling, dependencies, tests.

## Git workflow

Branch `advisor/008-extract-document-runtime`; commit `refactor(collaboration): encapsulate document runtime`.

## Target interface

Export a singleton runtime or factory-created singleton with only these capabilities (names may vary, semantics may not):

- `loadForJoin(documentId)` → encoded state, state vector, and current size status after one serialized DB load.
- `applyUpdate(documentId, update)` → discriminated result for accepted, invalid, update-too-large, document-too-large, or not-loaded, including optional size status. Accepted updates are already applied and scheduled for persistence.
- `evictIfEmpty(io, documentId)` → preserves save/recheck/keep-on-failure behavior.
- `discard(documentId)` → cancellation and destruction for deletion after transport evicts sockets.
- `flushAll()` → existing `{succeeded, failed}` shutdown result.

Do not expose Y.Doc instances, runtime maps, persistence states, timers, or size accounting. This is a deep module, not a file-splitting pass-through.

## Steps

1. Move document constants, state interfaces/maps, DB load/save, size accounting, and persistence scheduler into `document-runtime.ts` without changing code paths. Initially expose only temporary private-to-migration helpers necessary to compile; remove them by step 4.
   - **Verify**: `npm run typecheck:server` → exit 0.
2. Implement `loadForJoin`; switch join handling to use its encoded outputs. Preserve both access checks and all join-generation/drain checks around the load. The runtime must not know users, roles, sockets, or authorization.
   - **Verify**: `npm run lint && npm run typecheck:server` → exit 0.
3. Implement `applyUpdate`; move payload-size validation, preflight, Y.applyUpdate, size recovery on malformed input, and save scheduling behind it. Keep session/room/role checks in `index.ts`; map runtime results to exactly the existing socket events, acknowledgement codes, messages, and peer broadcast behavior.
   - **Verify**: `npm run build` → exit 0.
4. Move eviction, discard, and flush behavior behind the target interface. `handleDocumentDeleted` must still remove sockets/roles/awareness first, then call runtime discard. Preserve exported `flushAndCleanup()` from `index.ts` as a narrow compatibility re-export/wrapper if `server/src/index.ts` still imports it there. Remove all temporary helper exports.
   - **Verify**: `rg -n 'docs = new Map|loadedDocs|loadingDocs|persistenceStates|documentSizeStates|runPersistence|scheduleSave|Y\.applyUpdate|Y\.encodeStateAsUpdate' server/src/socket/index.ts` → no runtime-implementation matches; then `npm run typecheck:server && npm run lint && npm run build` → exit 0.
5. Manual matrix: two editors join and exchange updates; viewer update is rejected; reconnect catches up; save survives last-client eviction/rejoin; delete evicts both clients; oversized/malformed update behavior is unchanged; stop PostgreSQL during save and confirm state remains in memory/retries; graceful shutdown reports failed saves and succeeds after DB recovery.

## Test plan

Do not add automated tests; this is an explicit maintainer policy. The comprehensive manual matrix is mandatory because this extraction is high risk.

## Done criteria

- [ ] Runtime implementation and mutable lifecycle state are absent from `socket/index.ts`.
- [ ] Runtime interface exposes no Y.Doc/maps/timers.
- [ ] Socket orchestration retains auth, access, room, acknowledgement, and broadcast ownership.
- [ ] Every listed lifecycle/size/persistence invariant remains unchanged.
- [ ] Existing imports from routes/server remain compatible.
- [ ] Gates and manual matrix pass.

## STOP conditions

STOP if any step requires changing persistence timing, update limits/error codes, event payloads, access-check ordering, or shutdown semantics. STOP if the target interface must expose mutable internals; redesign the seam and report it instead.

## Maintenance notes

Future multi-instance work should replace this concrete process-local runtime, not leak coordination concerns back into Socket.IO handlers. Reviewers should compare behavior line-by-line against the old implementation, especially failure and cancellation paths.
