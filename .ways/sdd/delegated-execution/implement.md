# implement

Goal: Deliver specify.md.
Evidence: `execution` on WorkState/schema/status; `--delegated` on sdd start and plan promote; advanceSdd at implement in delegated mode requires tasks and rejects any commit after the decompose gate without Harness-Task (assertDelegatedImplementation in src/work/sdd.ts); guard.sh gains an Edit|Write|MultiEdit|NotebookEdit matcher that blocks main-worktree edits during delegated implement and allows them where .ways/runtime/task.json exists, resolving the repo from the edited file path; settings merge installs both matchers and verify requires both; statusline appends "delegated"; implementer/reviewer/qa prompts separated and opposed; sdd command documents inline vs delegated with parallel/sequential guidance; AGENTS.md rule rewritten. Tests: delegated gate rejection (enforcement.test.ts), guard edit cases and statusline (adapter.test.ts), settings matchers. Suite 58/58, scripts/check.sh passes, adapter reinstalled here.
Decision: Complete.
Gate: Proceed to review.
