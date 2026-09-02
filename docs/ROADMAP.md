# Roadmap

This roadmap defines the next milestones for latte-ways. It is the source of planned work; `README.md` remains a product overview.

## 1. Transactional safety

Make state updates, staging, and gate commits recoverable as one logical transaction.

- Add fault-injection coverage before and after writes, staging, commits, and cleanup.
- Define explicit recovery states for failed cherry-picks and partial worktree cleanup.
- Never infer progress silently or discard project changes.

## 2. Trustworthy memory

Make repository memory verifiable and maintainable over time.

- Verify local sources against paths and Git revisions.
- Add promotion, deprecation, freshness, and FAQ workflows.
- Detect contradictory active concepts without inventing a winner.
- Make `ways query` use the derived search index.

## 3. Installation and CLI hardening

Validate the package as a consumer would use it and make the CLI predictable.

- Test installation from `npm pack` as a consumer devDependency.
- Add robust argument parsing, command help, stable exit codes, and structured output.
- Improve bootstrap repository detection and require confirmation for inferred configuration.
- Add an idempotent migration and rollback fixture.

## 4. Adapter validation and approval evolution

Validate provider integrations in their real environments and strengthen human approval options.

- Exercise the pi extension and Codex/Cursor hook payloads in live sessions.
- Preserve the six-line role-prompt limit and fail-closed guard behavior.
- Evaluate a remote or signed approval channel for humans without a local terminal.

## Exit criteria: dogfood-ready

- Every mutation boundary has tested crash recovery.
- Failed task integration produces a recoverable state with no mixed commit.
- Bootstrap and upgrade pass from a packed consumer project.
- Memory has explicit promotion and stale/contradiction workflows.
- `scripts/check.sh` passes on a clean worktree.
