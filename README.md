# latte-ways

A minimal, agent-agnostic development harness. Git records history; an OKF v0.2 bundle records current knowledge; deterministic gates prevent SDD phase skipping.

## Install

```bash
npm install --save-dev latte-ways
npx ways bootstrap --test-command='["npm","test"]'
scripts/check.sh
```

Linux and macOS are supported. `CLAUDE.md` is a symlink to the canonical `AGENTS.md`.

## Modes

- `ways query <terms>`: read-only memory search; no state or commit.
- `ways quick start <id>`: direct implementation closed by `quick finish`.
- `ways plan start <id>`: disposable, versioned proposal.
- `ways sdd start <id>`: strict gated workflow, autonomous by default.

Run `ways status` before mutation. All completion commands require clean, atomic outcomes and record canonical Git trailers.

## SDD

```text
intake → explore → assess → specify → plan → decompose
→ implement → review → validate → reconcile-memory → close
```

Parallel implementers use task worktrees. The core creates packets and integrates traced commits but never launches an agent. Review is always delegated, independent, and read-only.

## Integrity

`scripts/check.sh` validates managed files, state, Git contracts, agent prompt length, OKF, deterministic indexes, and the configured unit-test command. Divergence fails closed and requires `ways repair`.

## Knowledge

Memory lives in `.ways/knowledge/`. Agent discoveries start as sourced `draft` concepts. Stable concepts require machine or human verification. `.ways/indexes/` is derived and rebuilt with `ways memory index`.
