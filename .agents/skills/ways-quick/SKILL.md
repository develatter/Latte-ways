---
name: ways-quick
description: Small direct change under harness rules
---

Arguments: `<id> [what to change]`

Run `npx ways status --json`; if work is already active, stop and report it. Otherwise run `npx ways quick start <id>` with the first word of the arguments the human gave with this skill as the slug and implement the rest of the request. Assess durable semantic impact as you work; when needed use $ways-memory to create a separately reviewed memory commit, while trivial changes need no artifact. Then run `scripts/check.sh`, fix anything it reports without bypassing it, close with `npx ways quick finish --message="<concise subject>"`, and report the commits. If the human asks to drop the work, run `npx ways quick cancel`.
