# explore

Goal: Locate seams.
Evidence: WorkState/profile lives in src/domain/types.ts and assets/schemas/state.schema.json; startSdd and promotePlan set profile; advanceSdd checks tasks at implement (src/work/sdd.ts). Task worktrees get .ways/runtime/task.json (src/work/tasks.ts:43), a reliable marker of "inside a task worktree". Integrated task commits keep Harness-Task trailers after cherry-pick. status.ts projects profile; statusline.sh prints it. The Claude guard already receives tool_name and cwd on PreToolUse, so a second matcher on Edit|Write|MultiEdit can reuse it. Role prompts live in assets/adapters/roles.
Decision: `execution: "inline" | "delegated"` on state (default inline); `--delegated` on `sdd start` and `plan promote`; advanceSdd at implement in delegated mode requires at least one task and rejects any commit after the decompose gate lacking Harness-Task; guard blocks Edit/Write/MultiEdit in the main worktree when status shows delegated+implement, allowed where .ways/runtime/task.json exists.
Gate: Proceed to assess.
