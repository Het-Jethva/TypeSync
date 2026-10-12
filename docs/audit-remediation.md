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
2. [x] AI selection safety for images and other non-text content. Shared guard rejects unsafe generation and acceptance; client clears unsafe previews. Multiline text remains supported.
3. [x] Table span and logical grid limits. Incoming and stored documents allow at most 200 rows, 100 logical columns and 10,000 grid slots per table, with 50,000 slots across nested document tables.
4. [x] Independent document saves after AI shutdown failures. Ordinary saves run alongside AI flushes; combined failures remain observable, and retry timers do not keep shutdown alive.
5. [x] Bounded socket join cancellation state. Pending joins use temporary identity tokens and an eight-operation cap; completed joins and ignored leaves retain no cancellation entries.
6. [x] Dashboard membership and cursor refresh on metadata changes. Remote metadata and local rename completion restart page one with the current search and sort.
7. [x] Dashboard refresh failure and retry state. Pending requests hide prior-query rows; failed initial or refresh reads expose persistent retry and successful retry restores pagination.
8. [x] Share dialog dismissal during reads. Close and Escape remain available during initial and post-mutation collaborator reads.
9. Share list error state and retry.
10. Bare hostname URLs with ports.
11. Environment file ignore patterns.
12. Shutdown deadlines and documented container grace.

Production configuration observations will be evaluated after source fixes. Missing DMARC and Neon branch retention were observations, not demonstrated defects. No deployment or push is part of this run.
