# Plan 004: Prevent stale collaborator-list responses

> **Executor instructions**: Implement this modal-only slice. Do not add tests. Update the plan index.
>
> **Drift check (run first)**: `git diff --stat 77bd4fc..HEAD -- client/src/components/ShareModal.tsx`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `77bd4fc`, 2026-07-19

## Why this matters

The share modal applies every collaborator response, even after a newer refresh, document change, or unmount. Out-of-order responses can display stale collaborator metadata and loading state. This slice gives each request explicit ownership and resets document-scoped state.

## Current state

`client/src/components/ShareModal.tsx:21-36` fetches in an effect with no cancellation/generation guard. Mutation handlers at `:38-84` call `fetchCollaborators()` without awaiting it. The collaboration hook demonstrates the repo's local `disposed` guard pattern at `client/src/lib/hooks/useCollaborativeDocument.ts:44-60`.

## Commands

`npm run typecheck`, `npm run lint`, `npm run build` → exit 0.

## Scope

**In scope**: `client/src/components/ShareModal.tsx`.

**Out of scope**: modal accessibility redesign, API changes, Dashboard fetching, tests.

## Git workflow

Branch `advisor/004-order-collaborator-refreshes`; commit `fix(sharing): ignore stale collaborator responses`.

## Steps

1. Add a request-generation ref. Each fetch captures a new generation and only that current generation may set collaborators, errors, or `isFetching`.
   - **Verify**: `npm run typecheck` → exit 0.
2. On `documentId` change, clear collaborator/success/error state, set loading true, start a refresh, and invalidate the generation during effect cleanup. Do not update state after unmount.
   - **Verify**: `npm run lint` → exit 0.
3. Await post-mutation collaborator refreshes (`handleUpdateRole`, `handleRemoveCollaborator`, `handleSubmit`) or explicitly `void` them where completion is not part of the action. Prefer awaiting so loading/error ownership is deterministic. Avoid duplicate user-facing errors.
   - **Verify**: `npm run build` → exit 0.

## Test plan

No automated tests. Manually use network throttling, change routes with browser navigation while the modal is open, and confirm old collaborator data never appears for the new document.

## Done criteria

- [ ] Stale/unmounted requests cannot mutate modal state.
- [ ] A changed `documentId` immediately clears old collaborator metadata.
- [ ] Mutation refresh promises are handled explicitly.
- [ ] Standard gates pass.

## STOP conditions

STOP if preserving modal state across document changes is a documented requirement, or if changes outside this component are needed.

## Maintenance notes

Any future collaborator pagination must track both request generation and page cursor.
