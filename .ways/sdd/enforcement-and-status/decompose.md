# decompose

Goal: Decide whether to split into parallel task worktrees.
Evidence: Steps in plan.md share store.ts, integrity.ts, cli.ts and the test fixtures; parallel worktrees would conflict on every integration.
Decision: No task packets. Implement inline in plan order, one commit per step is not required by the gate; the implement certification captures the whole diff.
Gate: Proceed to implement.
