# intake

Goal: Integrate the living-memory feature closed on development (02f2e00) onto master (e10d9fe) with master as source of truth for the harness.
Evidence: Development adds 24 files (src/memory/*, memory schemas, LIVING_MEMORY docs, memory adapters/tests) but predates the remediation machine; naive transplant conflicts on .ways/status.json and would delete src/work/remediation.ts, validation-failure.ts and adversarial coverage. Preview cherry-pick aborted cleanly in scratch worktree.
Decision: New inline SDD on master reusing development's reviewed design; port only feature additions and feature hunks of the 97 modified files, keep master's digest pinning, remediation evidence and discovery restriction untouched.
Gate: Intake accepted; proceed to explore the exact file/hunk inventory.
