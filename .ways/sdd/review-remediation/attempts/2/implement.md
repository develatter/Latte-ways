# implement

Goal: Close the two remaining attempt-1 review findings before a final independent review.
Evidence: `attempt-2-artifact-integration` integrated `f620239`, rejecting immutable prior-attempt artifact mutations at task integration. `attempt-2-validation-evidence` integrated seven commits `c54a992` through `2a3da22`, introducing committed digest-bound validation-failure records, replay validation, legacy handling, malformed-marker rejection and advance guards. Task-level `scripts/check.sh` reported 118 and 134 passing tests respectively; a main-worktree run observed duplicated test discovery under `.ways/worktrees/**` and timed out/fails, which remains for QA investigation.
Decision: Attempt 2 implementation is complete. Do not certify validation until independent review passes and QA isolates the worktree test-discovery issue.
Gate: All current-attempt tasks are recorded as completed; next step is a digest-bound adversarial review.
