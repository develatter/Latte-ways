# plan

Goal: Order the implementation so the repository stays green at every step.
Evidence: Hooks execute the CLI, so dist must exist before tests; package.json gains `pretest: npm run build`. Existing tests that intentionally commit outside gates will need `--no-verify` once hooks are active.
Decision:
1. status.json projection in src/state/status.ts, wired into store.ts, bootstrap, repair; integrity check; CLI `status --json`.
2. History verification in src/integrity/history.ts; CLI `check --history`; config.historySince in schema; check.sh runs both.
3. Hook command in src/hooks/hook.ts; CLI `hook commit-msg`; asset `.ways/hooks/commit-msg`; MANAGED_ASSETS entry; bootstrap/upgrade set core.hooksPath.
4. AGENTS.md rule; docs (README, acceptance, HANDOFF).
5. Tests for each of the above; adapt existing fixtures; regenerate this repository's managed files and manifest; set core.hooksPath here.
Gate: Proceed to decompose.
