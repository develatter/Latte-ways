# specify

Goal: Specify stable command configuration, execution results, and evidence replay.
Evidence: Named checks use the fixed order test, lint, typecheck, build, e2e; each command is an argv array, `required` selects checks, and timeoutMs is bounded. Results carry name, status, command, exitCode/detail; old testExitCode remains.
Decision: `HarnessConfig.commands` is optional and additive, with required non-empty names and optional per-name argv plus bounded timeoutMs. `runChecks` executes required commands sequentially, marks omitted required commands unavailable and non-required checks skipped, and kills detached process trees on timeout/signals/spawn failures. ValidationFailureRecord gains optional `commands` and `checks.named`; replay uses recorded commands when present, otherwise the unchanged legacy testCommand path.
Gate: Contract is explicit and shell-free; proceed to plan.
