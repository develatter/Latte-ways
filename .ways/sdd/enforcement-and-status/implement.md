# implement

Goal: Deliver the six plan steps inline.
Evidence: src/state/status.ts projects status.json from every saveState/removeState; src/integrity/history.ts audits trailers and SDD chains after an anchor; src/hooks/hook.ts judges commit messages against disk state, HEAD state, or the bootstrap exemption; assets/bootstrap/commit-msg is managed and bootstrap/upgrade set core.hooksPath; src/work/close.ts commits before removing untracked state so quick and unproposed plans stay traceable; check.sh runs check and check --history; AGENTS.md carries the quick-first rule; bootstrap now resolves realpath so macOS temp dirs work. tests/enforcement.test.ts adds 10 tests; suite is 41/41 and scripts/check.sh passes. A manual commit in this repository is rejected by the hook.
Decision: Implementation complete; no task packets were used.
Gate: Proceed to review.
