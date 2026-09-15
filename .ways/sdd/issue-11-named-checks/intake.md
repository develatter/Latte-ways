# intake

Goal: Add an additive named-check command contract with bounded execution and immutable validation evidence while preserving legacy testCommand records/replay.
Evidence: Issue #11 requires test/lint/typecheck/build/e2e arrays, deterministic required ordering, fallback testCommand, explicit result states, cleanup, and historical replay.
Decision: Implement the contract in config/domain/check/validation-failure paths and expose it through bootstrap and canonical check; keep services, browser orchestration, CI integrations, and implicit setup out of scope.
Gate: Scope and compatibility are clear; proceed to explore.
