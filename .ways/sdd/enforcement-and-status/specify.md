# specify

Goal: Define the exact contracts for the status artifact, commit acceptance, and history verification.
Evidence: See explore.md for seams. Contracts below are the specification.

## .ways/status.json (tracked, derived)
`{ schemaVersion: 1, active: boolean, mode?, id?, status?, phase?, profile?, humanGate?: boolean, gateCommit?, updatedAt }`.
Written by saveState (from state) and removeState (active:false). Integrity issue `status-divergence` when it does not equal the projection of current.json. `ways status --json` prints the same object.

## ways hook commit-msg <file>
Reads the trailers from the message file. Resolution order:
1. Disk state exists: require Harness-Work == state.id. Otherwise reject.
2. No disk state, HEAD has .ways/state/current.json: closing commit. Require Harness-Work == HEAD state id and Harness-State in {completed, cancelled}.
3. Neither: reject with a message naming `ways quick start <id>`, unless HEAD does not yet contain .ways/manifest.json (bootstrap commit exemption).
Exit 0 accepts, 1 rejects with reason on stderr. Hook file `.ways/hooks/commit-msg` (managed, executable) resolves the CLI like scripts/check.sh, honouring WAYS_CLI for tests. Bootstrap and upgrade set `core.hooksPath` to `.ways/hooks`.

## ways check --history [--since=<ref>]
Anchor: --since, else config.historySince, else the first commit that added .ways/manifest.json. Every commit strictly after the anchor on the first-parent line to HEAD must carry Harness-Work and Harness-State. For each Harness-State=completed commit with an SDD phase, the previous phase of that work must appear earlier in the range unless it is intake. Issues use code `history-untraced` / `history-broken-chain`. scripts/check.sh runs `check` and then `check --history` so CI fails closed.

## Integrity extension
With active state, every commit after baseCommit must carry Harness-Work == state.id (`work-untraced`). Runs inside checkIntegrity so quick finish, plan finish and sdd validate/close all enforce it.

## AGENTS.md rule
Add: "Every change, however small, opens `ways quick start <id>`; commits outside an active work are rejected."

Decision: Contracts above are final for this work. No env-based bypass beyond WAYS_CLI, which only relocates the CLI; the history check remains the backstop against --no-verify.
Gate: Proceed to plan.
