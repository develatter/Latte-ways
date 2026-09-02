# intake

Goal: Make harness compliance mechanical (hooks, history check, status artifact) so no commit bypasses the active mode, per source-plan.md.
Evidence: integrity.ts only validates state/Git when current.json exists; no hooks installed by bootstrap; `ways status` dumps raw JSON with no stable contract.
Decision: Accept the six-step source plan as scope. Adapters, approvals and reviewer digest binding stay out of this work.
Gate: Proceed to explore.
