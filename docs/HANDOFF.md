# Next-agent handoff

## Mission

Take latte-ways from a functional MVP to a dogfood-ready harness. Preserve its minimal, agent-agnostic core: provider-specific launching belongs in optional adapters, not here.

## Start here

1. Read `AGENTS.md`, `README.md`, `MAP.md`, and `docs/acceptance.md`.
2. Run `npx ways status`, `git status`, and `scripts/check.sh`.
3. Keep every agent prompt at six non-empty lines or fewer.
4. Do not weaken fail-closed state, Git trailers, delegated review, or OKF verification.

## Current baseline

- TypeScript CLI distributed as the `latte-ways` npm package with binary `ways`.
- Modes: `query`, `quick`, `plan`, and strict `sdd`.
- SDD phases, auto-commits, explicit repair, task worktrees, and review gates are implemented.
- OKF v0.2 validation and deterministic catalog, graph, and search indexes are implemented.
- Bootstrap, managed-file hashes, upgrade checklist, canonical Bash checks, and CI are implemented.
- The repository is clean and the full test suite passes at handoff.

## Priority 1: transactional safety

- Make state update, staging, and gate commit recoverable as one logical transaction.
- Add fault-injection tests before/after writes, staging, commits, and cleanup.
- Define conflict states and recovery for failed cherry-picks and partial worktree cleanup.
- Never silently infer progress or discard project changes.

## Priority 2: authentic approvals

- Replace the forgeable `--approved` flag with a portable human-approval artifact or TTY confirmation.
- Bind approval to work id, phase, artifact digest, and Git revision.
- Make reviewer independence mechanically inspectable rather than trusting a free-form string.
- Keep authentication optional at the adapter boundary only if the core can still verify evidence.

## Priority 3: trustworthy memory

- Verify local `sources` against paths and Git revisions, not only syntax.
- Add explicit promotion, deprecation, freshness, and FAQ workflows.
- Detect contradictory active concepts and surface them without inventing a winner.
- Make `query` consume the derived search index instead of rescanning Markdown.

## Priority 4: installation and CLI hardening

- Test installation from `npm pack` as an actual consumer `devDependency`.
- Add robust argument parsing, command-level help, stable exit codes, and structured output.
- Make bootstrap detect repository shape and test commands, then require confirmation.
- Generate a useful repository map without semantic guesses.
- Add at least one real, idempotent migration and rollback fixture.

## Known limitations

- Human approval is currently a CLI boolean and can be forged by an agent.
- Reviewer identity is declarative; read-only behavior is a protocol rather than a sandbox.
- Git/state operations have recovery commands but are not yet transaction-journaled.
- Worktree integration has happy-path coverage; conflict recovery needs dedicated states.
- Memory validation checks structure, trust, freshness, and links but not semantic truth.
- The search index is generated, while `ways query` still performs a linear scan.
- No PI, Codex, Claude, or Cursor adapter exists yet by design.

## Definition of dogfood-ready

- Every mutation boundary has tested crash recovery.
- A supervised gate cannot be approved by the acting implementation agent.
- Reviewer evidence is bound to the exact diff and cannot modify it unnoticed.
- Failed integration produces a recoverable state with no mixed commit.
- Bootstrap and upgrade are tested from a packed npm consumer project.
- Memory promotion and stale/contradictory knowledge have explicit workflows.
- `scripts/check.sh` passes and the worktree is clean.
