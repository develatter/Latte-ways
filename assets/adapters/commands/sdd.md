---
description: Start strict phased delivery
usage: <id> [--supervised]
---
Run `npx ways sdd start $ARGUMENTS`. Then work phase by phase: fill the current `.ways/sdd/<id>/<phase>.md` with Goal, Evidence, Decision and Gate, and advance with {{command:advance}}. Delegate implementation to {{role:implementer}}, review to {{role:reviewer}}, and never edit a certified phase file.
