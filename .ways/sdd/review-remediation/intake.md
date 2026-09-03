# intake

Goal: Add explicit, auditable SDD remediation transitions from failed review or validation back to the earliest phase required by the findings.
Evidence: The active living-memory SDD reached review, failed with blocking findings, and the current CLI exposes only forward advance; repair returns to the latest certification and cannot reopen implementation or design.
Decision: Deliver this urgently as an autonomous delegated SDD on an isolated hotfix branch before resuming living-memory.
Gate: Intake is complete when the failure mode, desired backward targets, immutability constraints, and delegated-execution requirements are explicit.
