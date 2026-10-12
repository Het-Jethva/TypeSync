# Audit remediation

Implementation baseline: 400bc22. The audit baseline was a22a4c6; the intervening commit rewrites README only.

## Workflow

- [x] Read the Principles section of Poteto Mode.
- [x] Phase A: Frame. Resolve all 12 ranked findings with separate checked commits. Keep tests focused on data loss, resource bounds and concurrency.
- [x] Phase B: Design the workflow. Compare AI durability designs first. Use the retained audit probes as baseline evidence.
- [ ] Phase C: Run the loop. Reproduce, fix, review, verify and commit each finding before starting the next.
- [ ] Phase D: Keep the audit trail. Record each completed unit in audit-remediation.tsv.
- [ ] Phase E: Verify and hand back. Run the full check suite and independent review.

## Fix queue

1. [x] AI acceptance durability and sync status. Automatic document/history retries, acceptance and join persistence cursors, and recovery bytes are covered by focused regression tests.
2. AI selection safety for images and other non-text content.
3. Table span and logical grid limits.
4. Independent document saves after AI shutdown failures.
5. Bounded socket join cancellation state.
6. Dashboard membership and cursor refresh on metadata changes.
7. Dashboard refresh failure and retry state.
8. Share dialog dismissal during reads.
9. Share list error state and retry.
10. Bare hostname URLs with ports.
11. Environment file ignore patterns.
12. Shutdown deadlines and documented container grace.

Production configuration observations will be evaluated after source fixes. Missing DMARC and Neon branch retention were observations, not demonstrated defects. No deployment or push is part of this run.


