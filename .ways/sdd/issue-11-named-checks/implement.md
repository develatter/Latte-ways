# implement

Goal: Implement and smoke-test named checks, bounded process execution, bootstrap/configuration, structured CLI output, and immutable replay evidence.
Evidence: Added `commands` schemas/types and bootstrap `--commands`; `runChecks` executes fixed-order argv commands with pass/fail/timed-out/skipped/unavailable results and process-tree cleanup; validation records persist `commands` and named results while old records retain their testCommand replay. Focused `tests/named-checks.test.ts` passed (4 tests), existing bootstrap/adapter/quick tests passed (18 tests), existing remediation/attempt tests passed (49 tests), and TypeScript compilation passed.
Decision: Implementation is complete in this worktree; no services, browser, setup execution, outcome loop, or CI integration was introduced.
Gate: Focused behavioral evidence and compatibility checks are green; proceed to review.
