---
description: Strict phased delivery with certified gates
usage: <id> [--supervised]
---
Run `npx ways sdd start $ARGUMENTS`, then work phase by phase: fill the current `.ways/sdd/<id>/<phase>.md` with Goal, Evidence, Decision and Gate, and certify it with `npx ways sdd advance`. Delegate implementation to {{role:implementer}}, review to {{role:reviewer}}, and testing to {{role:qa}}; never edit a certified phase file. At a supervised human gate, stop and ask the human to approve it themselves; never pass `--approved` on their behalf. Report each certification commit.
