# Plan 002: Remove sensitive identifiers from routine realtime logs

> **Executor instructions**: Execute as one behavior-preserving privacy slice. Do not add tests. Update `plans/README.md` on completion.
>
> **Drift check (run first)**: `git diff --stat 77bd4fc..HEAD -- server/src/socket/index.ts`
> Any mismatch around the cited log statements is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `77bd4fc`, 2026-07-19

## Why this matters

Routine Socket.IO logs record user email, user ID, document IDs, and document membership. Those values are unnecessary for normal operation and make production logs a secondary activity database. Error logs may retain document IDs where needed for diagnosis, but successful lifecycle logs should not contain account or document identifiers.

## Current state

`server/src/socket/index.ts` logs identifiers on connect (`:788`), join (`:875`), leave (`:919`), disconnect (`:1061`), eviction (`:594,610`), and deletion (`:721`). Errors such as persistence failures also include document IDs and are operationally useful. The server currently uses direct `console.log`/`console.error`; do not introduce a logging dependency in this slice.

## Commands

`npm run typecheck`, `npm run lint`, and `npm run build` must each exit 0.

## Scope

**In scope**: `server/src/socket/index.ts` only.

**Out of scope**: structured logging infrastructure, error-log redaction, request IDs, dependencies, tests.

## Git workflow

Branch `advisor/002-minimize-realtime-logs`; commit `fix(security): minimize realtime activity logs`.

## Steps

1. Delete successful lifecycle `console.log` statements that include email, user ID, or document ID: connect, join, leave, disconnect, aborted/successful eviction, and deletion. Keep aggregate shutdown/flush counts, which contain no identifiers.
   - **Verify**: `rg -n 'userEmail|User connected|User disconnected|joined document|left document|Evicted idle document|Document \$\{documentId\} deleted|Aborted eviction' server/src/socket/index.ts` → matches may remain for variables/control flow, but no matching `console.log` line may remain.
2. Keep error logs unchanged in this slice because they diagnose failed persistence and malformed stored state. Do not replace identifiers with hashes: stable hashes still permit activity correlation.
   - **Verify**: `npm run typecheck && npm run lint && npm run build` → exit 0.

## Test plan

No automated tests. This is log-only; verify with static search and the standard build gates.

## Done criteria

- [ ] Successful realtime lifecycle logs contain no account or document identifiers.
- [ ] Aggregate shutdown logs and actionable error logs remain.
- [ ] No logging package added.
- [ ] All verification commands pass.

## STOP conditions

STOP if a cited line has become an audit/security event required by documented policy, or if removing a log affects control flow.

## Maintenance notes

A future observability plan may introduce redaction-aware structured logging. Review new routine logs for email, user IDs, document IDs, cookie data, and session IDs.
