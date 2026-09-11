# decompose

Goal: Partition the port into wave-ordered atomic commits for one inline implementer.
Evidence: Plan waves 1-6 are strictly ordered by compile dependency; no parallel tracks exist (each wave needs the previous), so task worktrees add cost without benefit.
Decision: No task split; single inline implementation with one atomic commit per wave, each carrying Harness-Work: living-memory trailers. Rendered adapters excluded from porting (regenerated in wave 6).
Gate: Decomposition complete; proceed to implement wave by wave.
