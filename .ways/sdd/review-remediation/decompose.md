# decompose

Goal: Partition implementation into dependency-ordered, independently owned worktree tasks.
Evidence: Seven tasks are declared: contracts; parallel evidence and delegated-task mechanics; remediation state machine; audit/repair; CLI/status/adapters; final adversarial coverage. Dependencies prevent consumers from racing evolving contracts.
Decision: Assign `attempt-contracts`, `attempt-evidence`, `remediation-surface-adapters` and `remediation-adversarial` to Terra high; assign `attempt-tasks`, `remediation-machine` and `remediation-audit-repair` to Sol medium because they enforce state, trust and history invariants. Integrate only through `ways task integrate`; no orchestrator code edits.
Gate: Decomposition passes when ownership is bounded, dependency order is explicit, generated adapters are changed only through canonical sources, and final review and QA remain separate.
