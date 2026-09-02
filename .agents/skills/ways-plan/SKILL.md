---
name: ways-plan
description: Versioned plan proposal that can be executed, promoted to SDD, or abandoned
---

Arguments: `<id> [goal]`

Run `npx ways plan start <id>` with the first word of `the arguments the human gave with this skill` as the slug. Fill `.ways/plans/<id>.md` with goal, numbered steps and acceptance, then run `npx ways plan propose` and ask the human how to proceed. To execute: implement the steps, run `scripts/check.sh`, then `npx ways plan finish --message="<subject>" --memory=<updated|unchanged>`. To promote: `npx ways plan promote [--supervised]` and continue as $ways-sdd. To drop: `npx ways plan abandon`.
