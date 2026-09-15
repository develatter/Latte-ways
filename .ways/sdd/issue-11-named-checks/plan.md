# plan

Goal: Deliver the named checks contract atomically across types, schemas, bootstrap/config, execution, evidence, and focused compatibility coverage.
Evidence: Affected paths are src/domain, assets/schemas/config and validation-failure, src/check, src/bootstrap, src/cli, src/work/validation-failure, plus targeted tests; lifecycle and legacy replay callers can retain testExitCode.
Decision: First implement types/schemas/config/bootstrap/CLI, then the bounded runner and compatibility consumers, then immutable evidence/replay and focused tests. Use one traced implementation commit after smoke checks; no setup/browser/service behavior.
Gate: Implementation plan covers every acceptance criterion without cross-issue dependencies; proceed to decompose.
