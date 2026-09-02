---
description: Start a versioned plan proposal
usage: <id> [goal]
---
Run `npx ways plan start <id>` with the first word of `$ARGUMENTS` as the slug. Fill `.ways/plans/<id>.md` with goal, numbered steps and acceptance, then run `npx ways plan propose`. Ask whether to execute it ({{command:finish}}), promote it to SDD (`npx ways plan promote`), or abandon it.
