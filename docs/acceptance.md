# MVP acceptance

1. No SDD phase advances without a filled artifact and certified prior phase.
2. State survives interruption; Git divergence fails closed until explicit repair.
3. Quick work creates no committed planning or progress artifacts.
4. Proposed plans disappear from current state after completion or abandonment.
5. Parallel tasks use isolated worktrees and traced atomic commits.
6. Review is delegated, read-only, severity-gated, and repeatable.
7. Stable OKF concepts require verification; stale indexes fail integrity.
8. Bootstrap is reproducible on Linux/macOS and creates `CLAUDE.md` as a symlink.
9. Upgrades never overwrite modified managed files without checklist approval.
10. `scripts/check.sh` is the canonical local and CI entrypoint.
11. A commit outside an active work is rejected by the managed hook and, if bypassed, by `ways check --history`.
12. `.ways/status.json` always mirrors `current.json`; a stale artifact fails integrity.
13. Bootstrap renders every registered provider adapter from `assets/adapters/`; tampering with a rendered file fails integrity.
14. No role prompt exceeds six non-empty lines; loading the canonical source enforces it.
15. In delegated SDD, the implement gate refuses commits that were not integrated from a task; the orchestrator cannot implement.
16. A supervised human gate only advances with an approval bound to work, phase, gate commit and content digest; `ways approve` refuses without a TTY, the profile cannot be flipped on disk, and any later edit invalidates the approval.
17. A review is accepted only with the current diff digest and blocks the gate if the content changes afterwards.
