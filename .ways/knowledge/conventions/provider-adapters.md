---
type: convention
status: stable
verified: { by: human:alejandro.lopez, at: 2026-09-02T11:00:00Z }
generated: { by: orchestrator/claude-adapter, at: 2026-09-02T10:30:00Z }
sources:
  - resource: /assets/adapters
  - resource: /src/adapters/install.ts
  - resource: /src/adapters/claude.ts
  - resource: /src/adapters/codex.ts
  - resource: /src/adapters/cursor.ts
  - resource: /src/adapters/pi.ts
---

# Provider adapters

The canonical source for everything an agent provider sees lives in `assets/adapters/`: commands, roles, statusline and guard. Provider names never appear there; the source uses `{{command:x}}` and `{{role:x}}` placeholders that each renderer resolves.

Bootstrap renders Claude, Codex, Cursor and pi. A renderer is a pure function from source to files plus an idempotent `merge` for shared settings and a structural `verify` for what cannot be hashed. Codex commands are repository skills, Cursor commands are skills, and pi commands, roles and its guard/status extension live under `.pi/`. Rendered files are hashed in the manifest and re-rendered by upgrade.

Role prompts are limited to six non-empty lines; the loader rejects longer ones. Read-only roles (explorer, reviewer) render with restricted tools. The orchestrator is never a subagent; it is the main session acting under `AGENTS.md`. Advancing, finishing and cancelling are agent actions, not user commands.
