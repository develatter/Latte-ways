# assess

Goal: Select delivery mode and scope proportional to the workflow-integrity risk.
Evidence: The change spans state schemas, phase artifact addressing, review/validation evidence, tasks, approvals, guards, history validation, repair, status, adapters and adversarial lifecycle tests. Incorrect behavior can bypass delegated enforcement or corrupt certified history.
Decision: Keep strict delegated SDD. Do not downgrade. Scope the hotfix to explicit failed-gate remediation and the minimum attempt-aware infrastructure required for sound replay; defer unrelated living-memory findings.
Gate: Assessment passes as SDD because the change is cross-cutting, security-sensitive and requires independent review plus QA.
