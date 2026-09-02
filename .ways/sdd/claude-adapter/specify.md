# specify

Goal: Fix the neutral source format, the Claude rendering, and the manifest contract.

## Neutral source (assets/adapters/)
- `commands/<name>.md`: frontmatter `description`, optional `usage`; body is the instruction for the agent, may reference `$ARGUMENTS`. The body tells the agent which `npx ways ...` command to run and what to report.
- `roles/<name>.md`: frontmatter `description`, `access: read|write`; body is the prompt, at most six non-empty lines (enforced at render and by a test).
- `statusline.sh`: POSIX shell, reads `.ways/status.json` from the project dir given on stdin JSON (`workspace.project_dir`), prints `ways: idle` or `ways: <mode>:<id> @<phase> [<profile>]`. Uses only grep/sed, no Node.
- `guard.sh`: PreToolUse Bash hook. Reads stdin JSON; if `tool_input.command` matches `git commit` and `.ways/status.json` has `"active": false`, exits 2 with a message naming `/ways-quick`.

## Claude rendering (src/adapters/claude.ts)
- Commands -> `.claude/commands/ways-<name>.md` with frontmatter `description`, `argument-hint` from `usage`.
- Roles -> `.claude/agents/ways-<name>.md` with `name: ways-<name>`, `description`, `tools: Read, Grep, Glob, Bash` and `permissionMode: plan` for `access: read`; write roles omit tools (inherit).
- `statusline.sh` -> `.claude/ways-statusline.sh` (0o755); `guard.sh` -> `.claude/ways-guard.sh` (0o755).
- `.claude/settings.json`: read if present; set `statusLine = { type: command, command: .claude/ways-statusline.sh }` and append the guard to `hooks.PreToolUse` (matcher `Bash`) if absent. Written with stableJson; not hashed.

## Installer and manifest
- `installAdapter(cwd, provider, force)`: refuses to overwrite unmanaged existing files unless `--force`; writes files; records `manifest.adapters[provider][path] = sha256`.
- Manifest schema: optional `adapters: { [provider]: { [path]: sha } }`.
- Integrity: adapter files verified like managedFiles with codes `adapter-file-modified` / `adapter-file-missing`.
- Upgrade: after managed files, re-render every provider present in `manifest.adapters`; modified adapter files require the same checklist approval.
- CLI: `ways adapter list`, `ways adapter install <provider> [--force]`.

## Roles and commands
Roles: orchestrator, explorer, implementer, reviewer, qa-unit, qa-mutation, sweeper. Commands: status, query, quick, finish, cancel, plan, sdd, advance.

Decision: Contracts final for this work.
Gate: Proceed to plan.
