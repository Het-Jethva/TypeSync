# Plan 007: Encapsulate awareness protocol state behind one deep module

> **Executor instructions**: This is a behavior-preserving architecture slice. Move code; do not redesign protocol behavior and do not add tests. Run all gates and the two-client manual check. Update the index.
>
> **Drift check (run first)**: `git diff --stat 77bd4fc..HEAD -- server/src/socket/index.ts server/src/socket/awareness.ts server/src/socket/types.ts`
> New target files may be absent; changes in the source blocks cited below are a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (execute after plans 001–006 only to minimize merge drift)
- **Category**: tech-debt
- **Planned at**: commit `77bd4fc`, 2026-07-19

## Why this matters

Awareness validation, ownership, rate limiting, identity sanitization, and cleanup currently share one 1,087-line transport file with persistence and document synchronization. This slice places a seam around awareness behavior: Socket.IO orchestration supplies a socket/document/update and receives a sanitized update, while ownership and anti-abuse invariants stay hidden. The module must be deep—do not export its maps or low-level encoding helpers.

## Current state

- Socket aliases and `SocketData` are at `server/src/socket/index.ts:23-50`.
- Awareness maps are at `:81-87`, constants/schemas at `:100-136`, and implementation at `:162-298`.
- Callers are permission revocation/deletion (`:646-725`), connection initialization (`:727-789`), awareness handler (`:1019-1058`), and disconnect cleanup (`:1060-1075`).
- The security invariants are: one awareness client per socket/document, no client-ID takeover, monotonic clocks, server-owned presence identity, 16 KiB frames, token-bucket limiting, and disconnect after repeated violations. All must remain unchanged.

## Commands

`npm run typecheck:server`, `npm run lint`, `npm run build` → exit 0.

## Suggested executor toolkit

Use the `codebase-design` vocabulary if available. This module's interface is the seam; internal maps/helpers are implementation. Do not add ports/adapters because only one Socket.IO implementation exists and tests are intentionally absent.

## Scope

**In scope**: create `server/src/socket/types.ts`, create `server/src/socket/awareness.ts`, modify `server/src/socket/index.ts`.

**Out of scope**: event names/payloads, shared types, rate/size values, authentication, document updates, dependencies, tests.

## Git workflow

Branch `advisor/007-extract-awareness-module`; commit `refactor(presence): encapsulate awareness state`.

## Steps

1. Move `SocketData`, `TypeSyncSocket`, and exported `TypeSyncSocketServer` aliases unchanged to `server/src/socket/types.ts`. Re-export `TypeSyncSocketServer` from `index.ts` so routes keep their existing import. Avoid circular imports: `types.ts` may import only Socket.IO/shared types.
   - **Verify**: `npm run typecheck:server` → exit 0.
2. Create `awareness.ts` with a factory `createAwarenessManager()` and a small returned interface: initialize a socket's rate state; consume/sanitize an incoming update; release one socket/document binding (including broadcasting removal); forget all state for a disconnected socket; forget all ownership for a deleted document. Keep schemas, colors, maps, encoders, rate limiting, violation tracking, and identity construction private. Return the existing `{update, removed}` shape or `null`; do not expose maps/helpers.
   - **Verify**: `rg -n 'socketAwarenessBindings|awarenessClientOwners|AwarenessStateSchema|PRESENCE_COLORS' server/src/socket/index.ts` → no matches.
3. Instantiate exactly one manager inside `setupSocket` and replace all old helper calls. Preserve ordering: release before room leave; forget deleted-document state after sockets are removed; disconnect cleanup releases active document bindings before forgetting socket state; sanitized updates are broadcast only to peers.
   - **Verify**: `npm run lint && npm run build` → exit 0.
4. Manual check with owner plus collaborator: both see presence/carets; disconnect removes presence; viewer awareness still works; malformed/oversized awareness does not broadcast; permission revocation removes presence immediately.

## Test plan

Do not add automated tests. Absence of tests is intentional. Use typecheck/lint/build and the exact two-client checklist above.

## Done criteria

- [ ] `index.ts` contains no awareness ownership maps, encoding schemas, or sanitizer implementation.
- [ ] Awareness module exports no mutable maps or low-level codec helpers.
- [ ] All listed protocol/security invariants remain unchanged.
- [ ] Existing `TypeSyncSocketServer` import remains source-compatible.
- [ ] Gates and manual checks pass.

## STOP conditions

STOP if extraction requires changing shared event payloads, weakening an invariant, exporting mutable state, adding a hypothetical adapter, or touching document persistence logic.

## Maintenance notes

The manager interface is the test/maintenance surface even though automated tests are intentionally absent. Future presence fields belong inside its sanitizer, not in transport handlers.
