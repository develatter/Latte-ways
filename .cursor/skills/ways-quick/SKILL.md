---
name: ways-quick
description: Small direct change under harness rules
disable-model-invocation: true
---

Arguments: `<id> [what to change]`

Run `npx ways status --json`; if work is already active, stop and report it. Otherwise run `npx ways quick start <id>` with the first word of the arguments the human gave with this skill as the slug and implement the rest of the request. When done, run `scripts/check.sh`, fix anything it reports without bypassing it, then close with `npx ways quick finish --message="<concise subject>" --memory=<updated|unchanged>` (`updated` only if you changed `.ways/knowledge/`) and report the commit. If the human asks to drop the work, run `npx ways quick cancel`.
