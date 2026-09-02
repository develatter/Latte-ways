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
- `.ways/status.json` is a derived projection of the active state, verified by integrity and readable by any agent statusline.

Flexible means choosing the ceremony (`quick`, `plan`, `sdd`), never skipping it. Every change opens `quick` at minimum.

SDD runs inline or delegated. In delegated execution the main session is the orchestrator and never edits code: the implement gate only accepts commit hashes recorded by `task integrate`, so trailers alone prove nothing. Implementer, reviewer and qa are separate subagents with opposed objectives; the reviewer assumes the change is wrong until proven otherwise.
