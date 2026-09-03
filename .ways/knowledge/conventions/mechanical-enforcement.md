---
type: convention
status: stable
verified: { by: human:alejandro.lopez, at: 2026-09-02T09:20:00Z }
generated: { by: orchestrator/enforcement-and-status, at: 2026-09-02T09:10:00Z }
sources:
  - resource: /src/hooks/hook.ts
  - resource: /src/integrity/history.ts
  - resource: /src/state/status.ts
  - resource: /assets/bootstrap/commit-msg
---

# Mechanical enforcement

Compliance never depends on an agent obeying its prompt. Three layers make it mechanical:

- The managed `commit-msg` hook rejects any commit not traced to the active work. Closing commits must stage the deletion of the state file.
- `ways check --history` audits every commit after the anchor for `Harness-Work` plus `Harness-State` or `Harness-Task`, and verifies SDD certification chains. CI runs it, so `--no-verify` is caught later.
- `.ways/status.json` is a derived projection of the active state, verified by integrity and readable by any agent statusline. Remediation attempts add `attempt` and immutable remediation metadata; attempt zero keeps the original status shape.

Flexible means choosing the ceremony (`quick`, `plan`, `sdd`), never skipping it. Every change opens `quick` at minimum.

SDD runs inline or delegated. In delegated execution the main session is the orchestrator and never edits production code: the implement gate only accepts commit hashes recorded by `task integrate`, so trailers alone prove nothing. Provider guards block main-worktree production writes, including write-like shell commands, throughout delegated implement, review and validate, but permit phase artifacts, Ways orchestration and task worktrees. Implementer, reviewer and qa are separate subagents with opposed objectives; the reviewer assumes the change is wrong until proven otherwise.

Human gates are files, not flags. `ways approve` is the only harness path: it needs a real TTY and a typed phase name, and binds the approval to work, phase, gate commit and the digest of the diff since that gate. Supervised work opens with a traced commit so the state committed at HEAD, not the copy on disk, decides identity and profile. Reviews carry the digest from `ways review digest` and die on any later edit, so the review phase file is filled before the final review pass.
