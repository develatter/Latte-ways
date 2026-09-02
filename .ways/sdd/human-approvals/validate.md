# validate

Goal: Acceptance of items 16 and 17 in docs/acceptance.md.
Evidence: scripts/check.sh passes with 69 tests: supervised flow end to end through the real hook, TTY refusal of `ways approve` via the CLI, approval invalidated by content change and by gate move, profile flip and work rename rejected by advance and hook, stale review rejected at the gate. `ways approve` refused live in this non-TTY session. History audit flags abandoned openings.
Decision: Accepted.
Gate: Proceed to reconcile-memory.
