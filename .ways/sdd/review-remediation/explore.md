# explore

Goal: Establish the mechanical dead end, affected invariants, and safe additive remediation model.
Evidence: `advanceSdd` blocks failed review/validation without a backward edge; tasks are restricted to decompose/implement; repair only adopts the latest forward certification or destructively resets. Review digest baseline, overwriteable review artifacts, delegated guards, approvals, history replay, repair and status all need attempt-aware semantics.
Decision: The failed phase must transition through a traced remediation commit to implement, decompose, plan or specify. Preserve prior certifications and evidence byte-for-byte, create attempt-scoped phase/review/approval artifacts, require failure evidence, and force every cycle through fresh delegated implementation, review and validation.
Gate: Exploration is complete when the state-machine, evidence, immutability, delegated-task, digest, approval, guard, history and repair implications are identified.
