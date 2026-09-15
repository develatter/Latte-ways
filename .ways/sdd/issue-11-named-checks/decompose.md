# decompose

Goal: Keep issue #11 self-contained and avoid task/worktree dependencies with issues #3 and #4.
Evidence: All changes are within this issue's config/check/evidence boundary; no lifecycle outcome loop, eval framework, browser, service, or CI integration is required.
Decision: Implement inline in this isolated issue worktree with atomic source/schema/test commits; verify only focused tests and smoke scenarios, leaving full validation to the orchestrator.
Gate: No further decomposition is needed; proceed to implement.
