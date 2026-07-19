# Plan 001: Report document title saves truthfully

> **Executor instructions**: Execute this plan alone as a thin vertical slice. Run every verification command. Do not add tests: this repository intentionally has no test suite. Update this plan's row in `plans/README.md` when complete.
>
> **Drift check (run first)**: `git diff --stat 77bd4fc..HEAD -- client/src/components/DocumentHeader.tsx client/src/pages/DashboardPage.tsx`
> If either current-state excerpt no longer matches, STOP and report rather than adapting silently.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `77bd4fc`, 2026-07-19

## Why this matters

The header currently declares a rename saved after one second regardless of the HTTP result. A rejected request leaves the unsaved title visible. This slice makes the callback asynchronous, keeps the saving state tied to the request, and restores the authoritative title on failure.

## Current state

- `client/src/components/DocumentHeader.tsx:8-11` declares `onRename: (title: string) => void`.
- `client/src/components/DocumentHeader.tsx:31-39` calls `onRename(title.trim())` without awaiting it and uses `setTimeout` to mark completion.
- `client/src/pages/DashboardPage.tsx:200-208` catches rename failures and does not propagate failure.
- Client errors use `err instanceof Error`, notifications go through `addNotification`, and strict TypeScript is enabled. Preserve these conventions.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0, no warnings |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**: `client/src/components/DocumentHeader.tsx`, `client/src/pages/DashboardPage.tsx`.

**Out of scope**: API/server rename behavior, notification redesign, tests, title validation changes.

## Git workflow

Use branch `advisor/001-reliable-title-renames`. Commit message: `fix(editor): report title save results` (matching the repository's conventional commit history). Do not push unless instructed.

## Steps

1. In `DocumentHeaderProps`, change `onRename` to return `Promise<void>`. Replace the timer-based status with an async blur handler. Trim once; if empty or unchanged, restore `document.title`. Otherwise set `saving`, await `onRename`, and on rejection restore `document.title`. Always return to `saved` in `finally`. Keep editing closed while the request runs.
   - **Verify**: `npm run typecheck` → exit 0.
2. In `DashboardPage.handleRenameDocument`, preserve the existing notification but rethrow the caught error after notifying so the header can restore its value. Do not duplicate notifications in the header.
   - **Verify**: `npm run lint` → exit 0.
3. Manually run the client against the API and verify one successful rename updates the list, then stop the API and attempt another rename: the notification appears and the header restores the prior title.
   - **Verify**: `npm run build` → exit 0.

## Test plan

Do not add automated tests; their absence is an explicit maintainer decision. Use the manual failure-path check in step 3 plus typecheck, lint, and build.

## Done criteria

- [ ] No `setTimeout` controls title save status.
- [ ] `onRename` has a `Promise<void>` contract.
- [ ] Failed rename restores `document.title` and still emits one notification.
- [ ] Typecheck, lint, and build pass.
- [ ] Only in-scope source files and `plans/README.md` changed.

## STOP conditions

STOP if `onRename` has additional callers, rename errors cannot be propagated without changing the API layer, or any verification fails twice.

## Maintenance notes

Reviewers should ensure blur cannot produce an unhandled rejection and that Escape still restores the title. Future autosave statuses should be driven by promises/events, never elapsed time.
