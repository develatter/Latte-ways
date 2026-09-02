# latte-ways

A minimal, agent-agnostic development harness with Git-backed workflows, deterministic SDD gates, and living OKF v0.2 memory.

> The core workflow, mechanical enforcement, human approvals and digest-bound reviews are implemented and tested. See the [roadmap](docs/ROADMAP.md) for planned milestones and [`docs/HANDOFF.md`](docs/HANDOFF.md) for operational context.

## Why

Long-running coding agents tend to lose state, skip process, perform unnecessary rituals, and preserve stale documentation as truth. Latte Ways separates those concerns:

- **Git** is the immutable work log.
- **OKF memory** describes the repository as it exists now.
- **Explicit modes** let the engineer choose the required ceremony.
- **Deterministic gates** prevent SDD phases from being skipped.
- **Portable agent archetypes** keep the core independent of any provider.

## Requirements

- Linux or macOS
- Node.js 20 or newer
- Git

## Installation

```bash
npm install --save-dev latte-ways
npx ways bootstrap --test-command='["npm","test"]'
scripts/check.sh
```

Bootstrap creates the repository contract, including `AGENTS.md`, `MAP.md`, `.ways/`, `scripts/check.sh`, a `CLAUDE.md` symlink to `AGENTS.md`, the managed `commit-msg` hook, and the adapter files for every supported agent (Claude Code, Codex, Cursor, pi). Commit the result; from then on the agent you talk to follows the harness.

## Using the harness day to day

You never need the CLI: you talk to your coding agent and it drives `ways` for you. The commands below are the same in every agent, only the invocation prefix changes (see the provider table).

| You want | Say or type | What happens |
| --- | --- | --- |
| Know where things stand | `/ways-status` | The agent reads `.ways/status.json` and reports mode, work, phase, gate |
| Ask about the code or memory | `/ways-query token rotation` | Read-only search, no state, no commit |
| A small change | `/ways-quick button-spacing fix the padding` | Opens quick work, implements, runs `scripts/check.sh`, commits once |
| A change worth a proposal | `/ways-plan auth-refresh` | Writes and commits a plan; you decide execute, promote or abandon |
| A long delivery | `/ways-sdd auth-refresh --supervised --delegated` | Phased delivery with certified gates; delegated means subagents implement |

Plain language works too: "fix the padding on the button" makes the agent open a quick work, because commits outside a work are rejected by the hook. During a work, ask the agent to advance, finish or cancel; those are agent actions, not commands you run.

Supervised SDD stops at intake, plan and close until you approve in your own terminal:

```bash
npx ways approve
```

It shows the work, phase, gate and content digest, asks you to type the phase name, and writes an approval that dies if anything changes afterwards. Agents cannot run it: it refuses without a TTY.

If something looks wrong, `npx ways status`, `npx ways check` and `npx ways repair diagnose` explain the state without changing it.

## Work modes

| Mode | Purpose | Persistent ceremony |
| --- | --- | --- |
| `query` | Read-only exploration and memory search | None |
| `quick` | Small direct change | State during work, checks, one final commit |
| `plan` | Versioned proposal that can execute, promote, or be abandoned | Proposed plan until resolved |
| `sdd` | Strict phased delivery, inline or multiagent | State, gates, tasks, review, validation |

```bash
npx ways query "token rotation"
npx ways quick start button-spacing
npx ways plan start auth-refresh
npx ways sdd start auth-refresh --supervised
npx ways status
```

## SDD lifecycle

```text
intake → explore → assess → specify → plan → decompose
→ implement → review → validate → reconcile-memory → close
```

Each transition validates the previous certification in Git, updates JSON state, and creates an atomic commit with machine-readable trailers. `assess` can explicitly downgrade small work to `quick` or `plan`.

SDD runs `inline` (the agent may implement itself) or `--delegated` (the session is the orchestrator and never edits code: implementation always arrives through subagent task worktrees, integrated in dependency order, in parallel when independent). The implement gate in delegated mode rejects any commit that was not integrated from a task, and the Claude guard blocks `Edit`/`Write` in the main worktree during that phase.

Parallel tasks run in isolated worktrees. The core creates task packets and integrates traced commits, but deliberately does not launch agents. Review is delegated, read-only, severity-gated, and required even when implementation is inline. The review JSON carries the digest printed by `ways review digest`; submit and the gate recompute it, so a review dies with any later edit.

Supervised profile (`--supervised`) opens the work with a traced commit that fixes the profile in Git, and adds human gates at intake, plan and close. The way through is `ways approve`, run by the human in a real terminal: it refuses without a TTY, shows the gate and digest, asks for the phase name to be typed, and writes `.ways/sdd/<id>/approvals/<phase>.json` bound to work, phase, gate commit and content digest. The gate, the commit-msg hook and the provider guard all verify that binding; there is no flag an agent can pass, flipping the profile on disk is rejected, and any edit after approval invalidates it. What remains unverifiable locally is authorship: an agent with unrestricted shell access could still fabricate the file, so the barrier is against tool-driven and CLI-driven approval, not against a hostile shell.

## Knowledge

The current repository memory is an OKF v0.2 bundle under `.ways/knowledge/`. Supported core types are `system`, `component`, `convention`, `decision`, and `faq`; custom OKF types remain valid.

Agent-authored knowledge starts as a sourced `draft`. Stable concepts require deterministic or human verification. Search, graph, and catalog indexes under `.ways/indexes/` are derived and reproducible:

```bash
npx ways memory check
npx ways memory index
npx ways query "authentication convention"
```

## Integrity and recovery

```bash
scripts/check.sh
npx ways repair diagnose
npx ways upgrade
```

The canonical check validates managed files, schemas, state/Git consistency, compact agent prompts, OKF, derived indexes, and the configured unit-test command. Divergence fails closed; repair and destructive rollback always require explicit commands.

## Mechanical enforcement

Compliance does not depend on the agent obeying its prompt:

- Bootstrap installs a managed `commit-msg` hook under `.ways/hooks/` and sets `core.hooksPath`. Any commit not traced to the active work with a matching `Harness-Work` trailer is rejected. Small edits open `ways quick start <id>` first.
- `ways check --history [--since=<ref>]` audits every first-parent commit after the anchor (`--since`, `historySince` in config, or the commit that introduced `.ways/manifest.json`) for trailers and unbroken SDD certification chains. `scripts/check.sh` runs it, so a `--no-verify` bypass still fails in CI.
- With an active work, integrity also fails on any commit after its base that lacks the work trailer.
- Certifying a supervised human gate requires a bound approval artifact in the same commit; the closing commit must delete the one committed for `close`. Tool writes under `approvals/` and `reviews/` are blocked by the guard.

## Provider adapters

`assets/adapters/` is the canonical source: five commands, five roles (explorer, implementer, reviewer, qa, sweeper) with prompts of at most six lines, a statusline script, and a commit guard. The orchestrator is not a subagent: it is the main agent the human talks to, instructed by `AGENTS.md`. Bootstrap renders every registered provider from that source; `ways adapter install <provider> [--force]` regenerates one. Rendered files are hashed in the manifest, verified by integrity, and re-rendered by `ways upgrade` after checklist approval.

Each adapter follows the provider's current official documentation. Every one ships the same guard script fed with JSON on stdin: it blocks `git commit` without an active work and blocks edits in the main worktree during delegated implementation.

| Provider | Commands | Roles | Guard | Status |
| --- | --- | --- | --- | --- |
| Claude Code | `.claude/commands/ways-*.md`, invoked `/ways-quick` | `.claude/agents/ways-*.md`, read roles get `tools` and `permissionMode: plan` | `PreToolUse` in `.claude/settings.json` (merged) | `statusLine` wrapped around yours |
| Codex CLI | `.agents/skills/ways-*/SKILL.md`, invoked `$ways-quick` | `.codex/agents/ways-*.toml`, read roles get `sandbox_mode = "read-only"` | `PreToolUse` in `.codex/hooks.json` (merged) | not supported by Codex |
| Cursor | `.cursor/skills/ways-*/SKILL.md`, invoked `/ways-quick` | `.cursor/agents/ways-*.md`, read roles get `readonly: true` | `beforeShellExecution` and `preToolUse` in `.cursor/hooks.json` (merged, fail closed) | not supported per project |
| pi | `.pi/prompts/ways-*.md`, invoked `/ways-quick` | `.pi/agents/ways-*.md` for the subagent extension, read roles get `tools: read, grep, find, ls` | `.pi/extensions/ways/index.ts` on `tool_call` | same extension, `setStatus` in the footer |

Provider notes: Codex and Cursor only load project hooks in trusted projects, and pi asks for project trust before loading `.pi/`; Codex has no project prompts, so commands are repository skills; pi has no built-in subagents, so the role files target its documented subagent extension. `AGENTS.md` is read natively by all four. Advancing, finishing and cancelling are done by the agent through the CLI when the human asks; they are not user commands.

## Observable status

`.ways/status.json` is a tracked, derived projection of the active state: `active`, `mode`, `id`, `status`, `phase`, `profile`, `humanGate`, `gateCommit`, `updatedAt`. It is rewritten on every transition, verified by integrity, and cheap to read from any agent statusline. `ways status --json` prints the same object.

Upgrades compare managed-file hashes and never overwrite modified files without checklist approval.

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
scripts/check.sh
```

The implementation lives in `src/`, bootstrap resources in `assets/`, and integration tests in `tests/`. Do not edit generated `dist/` files.

## Current test baseline

- Contract, Git, bootstrap, integrity, mode, SDD, repair, upgrade, OKF, indexing, review, and worktree integration coverage
- End-to-end SDD lifecycle test
- GitHub Actions using the same `scripts/check.sh` entrypoint

## License

MIT
