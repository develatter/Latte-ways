# plan

Goal: Define an integration-safe implementation sequence for delegated worktrees.
Evidence: Specification identifies two independent foundations (memory model/Git digest and derived index cache) followed by discovery/incremental and release workflows, then a shared adapter/migration/baseline integration layer.
Decision: Use six tasks: (1) memory model, configuration, source/coverage validation, canonical relevant-tree digest and Git primitives; (2) untracked lazy indexes and indexed query; (3) bootstrap discovery and incremental memory commit/review workflow, depending on 1 and 2; (4) release reconciliation generations and merge topology, depending on 1; (5) migration, canonical adapters/templates and CLI integration, depending on 2, 3 and 4; (6) repository baseline, CI/branch documentation, packed-consumer and end-to-end adversarial coverage, depending on 5. Run 1 and 2 in parallel, then 3 and 4 in parallel.
Gate: Each task has isolated ownership where possible, focused tests, required trailers, and explicit dependencies; proceed to decomposition.

## Integration constraints

- Tasks change `src/`, `assets/`, and `tests/`, never `dist/`.
- Shared-file changes in later tasks are serialized through dependencies.
- Each implementer must read source-plan.md and specify.md, preserve legacy behavior through migration, run focused tests, and return exact commit hashes.
- Task 6 must not claim remote controls that cannot be verified locally.
- After integration, independent reviewer and QA inspect the combined digest, not task-local snapshots.
