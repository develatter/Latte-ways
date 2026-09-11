# implement

Goal: Integrate RR-005 nested test discovery and RR-006 Git-dependent review digest fixes exclusively from delegated attempt-3 task worktrees.
Evidence: attempt-3-discovery integrated as ca5a0be restricting Vitest include to tests/**/*.test.ts; attempt-3-digest integrated as 70a51b0 pinning --src-prefix=a/ --dst-prefix=b/ in both digest paths with tests/digest.test.ts and mnemonic remediation coverage. scripts/check.sh passes 25 files / 142 tests.
Decision: Both high findings are addressed without orchestrator production edits and with prior attempt artifacts preserved.
Gate: All attempt-3 tasks completed and recorded; implementation may proceed to digest-bound review.
