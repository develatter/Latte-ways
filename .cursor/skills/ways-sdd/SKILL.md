---
name: ways-sdd
description: Strict phased delivery with certified gates, inline or delegated
disable-model-invocation: true
---

Arguments: `<id> [--supervised] [--delegated]`

Run `npx ways sdd start` with the arguments the human gave with this skill, then work phase by phase: fill `.ways/sdd/<id>/<phase>.md` with Goal, Evidence, Decision and Gate, and certify with `npx ways sdd advance`; never edit a certified phase file. Assess durable semantic impact progressively and use /ways-memory for separately reviewed memory commits when needed. The reconcile-memory phase records whether incremental memory or release reconciliation was required; it never demands a no-op artifact. At a supervised human gate stop and ask the human to run `npx ways approve` in their own terminal; you cannot approve and must not touch `approvals/` or `reviews/`. During review give ways-reviewer the digest from `npx ways review digest`; it must appear in the review JSON, and any later edit invalidates the review.
Inline (default): you may implement yourself, and still use ways-explorer, ways-reviewer and ways-qa when useful.
Delegated (`--delegated`): you are the orchestrator and never edit code. At decompose declare tasks with `npx ways task add <id> --title=... [--depends=a,b]`, offering the human parallel or sequential splits. At implement, for each ready task run `npx ways task prepare <id>` and launch one ways-implementer on its worktree with the packet in `.ways/runtime/task.json`; run independent tasks in parallel and dependent ones in sequence; integrate with `npx ways task integrate <id> --commits=...` in order. Delegate review to ways-reviewer and testing to ways-qa, relay their findings back to implementers, and only advance when the gate passes.
