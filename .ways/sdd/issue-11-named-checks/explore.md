# explore

Goal: Trace the current single testCommand through bootstrap, config schema, check execution, and validation-failure replay.
Evidence: runChecks executes one detached shell-free child and returns testExitCode; ValidationFailureRecord stores only testCommand and testExitCode; replay reloads current config then compares testCommand, so multi-check selection must be persisted in the record and replayed from that immutable contract. Existing legacy evidence uses configured-tests and legacy replay calls runChecks.
Decision: Add optional `commands` config with named command arrays plus `required` and `timeoutMs`, retain v1 testCommand as fallback, and make runChecks return ordered named results. Extend failure records additively with a recorded contract/results while leaving old fields and legacy replay path valid.
Gate: Existing callers can derive pass/fail from a compatibility testExitCode; proceed to assess.
