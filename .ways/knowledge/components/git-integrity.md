---
type: component
status: stable
generated: { by: process:baseline-discovery, at: 2026-09-03T00:00:00Z }
verified: { by: process:baseline-review, at: 2026-09-03T00:00:00Z }
sources:
  - { resource: /src/git, revision: 4723b5d6143f4da2fa4e84a144af5ef148953975 }
  - { resource: /src/integrity, revision: 4723b5d6143f4da2fa4e84a144af5ef148953975 }
  - { resource: /src/hooks, revision: 4723b5d6143f4da2fa4e84a144af5ef148953975 }
---

# Git and integrity

The Git repository abstraction performs object, tree, merge, worktree, and commit operations without silently inferring progress. Integrity verifies managed hashes, workflow state, status projection, OKF, and first-parent trace history. The commit-msg hook enforces active-work trailers at commit time; history checks catch bypasses in CI.
