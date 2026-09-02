# specify

Goal: Contracts.

## State
`execution?: "inline" | "delegated"` in WorkState and schema; absent means inline. Set by `ways sdd start <id> [--supervised] [--delegated]` and `ways plan promote [--supervised] [--delegated]`. status.json gains `execution` when SDD; statusline appends `delegated` when set.

## Gate enforcement (src/work/sdd.ts)
At `implement` in delegated mode: `state.tasks.length > 0`, all tasks completed (existing), and every commit in `gateCommit..HEAD` carries `Harness-Task` (error names the offending commit). Inline mode unchanged.

## Claude guard (assets/adapters/guard.sh)
Second PreToolUse group with matcher `Edit|Write|MultiEdit|NotebookEdit`, same script. For those tools: if `.ways/runtime/task.json` exists at the git toplevel of cwd, allow. Else if status.json shows mode sdd, execution delegated and phase implement, exit 2 with a message naming {{role:implementer}}. Otherwise allow.

## Roles
implementer: implements only; must not review or judge scope; returns commits and evidence. reviewer: assumes the change is wrong until evidence proves otherwise; hunts regressions; never fixes. qa: only tests; reports; never changes production code. explorer, sweeper unchanged.

## sdd command and AGENTS.md
`usage: <id> [--supervised] [--delegated]`. Inline: the session may implement itself and may still use explorer/reviewer/qa subagents. Delegated: the session is the orchestrator, never edits code; at decompose it declares tasks with dependencies, at implement it prepares worktrees and launches one implementer per task, in parallel for independent tasks and in sequence for dependent ones, integrates commits in order, then delegates review and qa. AGENTS.md: replace the orchestrator line with this rule.

Decision: Final.
Gate: Proceed to plan.
