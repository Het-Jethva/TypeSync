# Audit repairs

The 13 October 2026 audit identified seven issues. Each now has a repair commit. Independent review found an additional pagination case, which has its own correction commit.

| Issue | Repair |
| --- | --- |
| Malformed link attributes crash rendering | `b60b9aa` validates link addresses in the shared editor schema before saving or reopening. |
| AI starts after edit access is lost during a save | `72141f9` checks current permission before generation and records a failed suggestion when access is denied. |
| Autosave drops loaded dashboard pages | `358e766` preserves pages and cursor during metadata changes. `c1e793b` also inserts changed documents absent from the loaded collection and guards stale responses and revocation. |
| List markers disappear | `59e9338` restores bullet and numbered markers while preserving task list styling. |
| Anchored panels extend below the viewport | `cf8aeeb` flips and clamps panels and scrolls oversized content. Normal panels retain their shadows. |
| Database waits have no deadline | `689edb8` adds connection and query deadlines. `e95144d` removes an incompatible session setting after verifying the production pooler. The final policy limits connection waits to 5 seconds and query responses to 10 seconds. |
| Editor controls lack accessibility metadata | `9d06292` names editors and the title input and exposes formatting and menu expansion states. |

## Verification

`npm run check` passed after the final application correction at `e95144d`. Lint, workspace type checks, all 33 tests, and all production builds passed. Three regression cases were added to the existing backend tests. The existing large editor bundle warning remains.

The actual Dockerfile rebuilt successfully. The isolated PostgreSQL and Docker checks passed all 32 checks, including migrations, pagination, access boundaries, concurrent writes, readiness, and graceful shutdown. Disposable fixture containers were removed.

The real application pool rejected stalled startup and query responses at their deadlines. Long queries on local PostgreSQL, direct Neon, and pooled Neon returned the client timeout; the pool answered a subsequent query. Production uses a Neon pooled URL. A session statement limit is not reliable across its backend handoffs, so the final repair bounds application waits without depending on session settings or changing infrastructure.

Browser checks used the maintained frontend with an isolated local API fixture. They confirmed 55 loaded documents remain after autosave, an excluded active document enters a matching search after rename, correct list markers, menu containment in 600px and 120px viewports, keyboard reachability and focus restoration, named inputs, formatting state changes, and disclosure state. Callback checks additionally covered stale responses, pagination continuation, current roles, revocation, and rename cleanup.

The decision trail is [audit-repairs.tsv](audit-repairs.tsv). Detailed local evidence and rerunnable checks are in the gitignored `.audit` directory of the original checkout. They are not included in a fresh clone.

## Limits

Database limits apply to connection waits and query responses, not an entire route or transaction. A client timeout does not prove that PostgreSQL canceled the statement. Callers can receive a timeout after a statement committed, as with other connection failures.

Accessibility verification inspected names and state in the browser. It did not run a screen reader. Local UI checks used fixture authentication and network responses. Signup email delivery, password recovery, long session expiry, native mobile input, saturation, database failover, and production process-kill durability remain outside this repair verification.

Sequence Work into Verifiable Units shaped the separate commits and checks. Prove It Works required actual renderer, service, database, and browser evidence. Model the Domain kept sidebar reconciliation in the existing typed document collection.

Fresh GPT-6.1 Sol reviewers with medium reasoning accepted the final application changes. They caught the missing search-membership case before shipping. A separate review accepted the final pooler-compatible deadline policy. No blocking findings remain. Their notes concern the deadline semantics and the verification limits stated above.
