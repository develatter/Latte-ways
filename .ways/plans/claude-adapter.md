---
type: plan
status: proposed
work: claude-adapter
---

# Goal

Let a human drive the harness from Claude Code through natural language or
slash commands, never the CLI, while the core stays provider-agnostic. Every
generated file is managed, hashed, upgradable, and verified by integrity.
Role prompts stay at six non-empty lines or fewer.

# Plan

1. Neutral adapter source under `assets/adapters/`: `commands/*.md` (frontmatter
   `description`, `usage`, body = CLI invocation with `$ARGUMENTS`), `roles/*.md`
   (frontmatter `access: read|write`, `description`; body = prompt, max six
   lines), `statusline.sh` (reads `.ways/status.json` with the shell only), and
   `guard.sh` (blocks `git commit` from agents when no work is active).
2. `src/adapters/` with a `ProviderAdapter` interface (`id`, `render(source)`)
   and a Claude implementation: commands to `.claude/commands/ways-<name>.md`,
   roles to `.claude/agents/ways-<name>.md` with `permissionMode: plan` for
   read-only roles, statusline to `.claude/ways-statusline.sh`, guard to
   `.claude/ways-guard.sh`, and `.claude/settings.json` gaining `statusLine`
   and a `PreToolUse` Bash hook. Existing settings are merged, never replaced.
3. CLI `ways adapter install <provider> [--force]` and `ways adapter list`.
   Installed files enter `.ways/manifest.json` under `adapters.<provider>` so
   integrity and upgrade verify and re-render them.
4. Role catalogue: orchestrator, explorer, implementer, reviewer, qa-unit,
   qa-mutation, sweeper. Reuse the existing four prompts; write three new ones.
   Commands: quick, plan, sdd, advance, status, query, finish, cancel.
5. Tests: rendering of every asset, settings merge, manifest entries, integrity
   failure on a modified adapter file, upgrade re-render, prompt line limit.
   Docs: README adapter section, HANDOFF, acceptance. Install the adapter in
   this repository as dogfood.

# Acceptance

- `ways adapter install claude` on a bootstrapped repo yields working slash
  commands, seven subagents, a statusline showing mode/id/phase, and a guard.
- Modifying any generated file fails `scripts/check.sh`; `ways upgrade`
  re-renders it after checklist approval.
- No role prompt exceeds six non-empty lines; `src/` has no Claude-specific
  strings outside `src/adapters/claude.ts`.
