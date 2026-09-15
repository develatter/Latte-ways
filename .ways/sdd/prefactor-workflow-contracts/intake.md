# intake

Goal: Prefactor legacy SDD lifecycle verification behind an explicit, versioned workflow contract without changing the CLI, defaults, or stored legacy meanings.
Evidence: Issue #3 defines four acceptance criteria: centralized transition semantics, legacy compatibility, fail-closed version/record validation, and characterization coverage across completion, remediation, tampering, and recovery. It has no blockers.
Decision: Proceed as autonomous inline SDD. Limit scope to the mechanical prefactor; do not add the simplified workflow from the parent epic.
Gate: Accepted. The ticket is unblocked, implementation-sized, and has concrete compatibility and verification criteria.
