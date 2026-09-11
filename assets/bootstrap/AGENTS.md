# Ways

- Read `README.md` and `MAP.md`; run `npx ways status` before mutation.
- Obey the active mode and state. Never skip, forge, or edit a gate.
- Advance, finish and cancel work through the CLI on the human's request. In delegated SDD you are the orchestrator: never edit code; delegate implementation to task worktrees, review to the reviewer, testing to qa; stop on divergence or failed checks.
- Every change, however small, opens `npx ways quick start <id>`; commits outside an active work are rejected.
- In this package, change `src/`, `assets/`, and `tests/`; never edit `dist/`.
- Keep commits atomic and run `scripts/check.sh` before completion.
- Treat `.ways/knowledge/` as durable current truth: assess semantic impact progressively, create separately reviewed memory commits when needed, and never require no-op memory artifacts.
- Complete reviewed discovery after bootstrap; run full rediscovery only on explicit request, and validate reconciliation before release.
- Derived `.ways/indexes/` are disposable caches; change managed files through source templates, then regenerate them.
