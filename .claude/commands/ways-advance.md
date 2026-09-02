---
description: Certify the current SDD phase and move to the next one
---

Run `npx ways status --json`. Confirm the current phase file has real evidence, then run `npx ways sdd advance`. If the phase is a supervised human gate, stop and ask the human to run the approval themselves; do not pass `--approved` on their behalf. Report the certification commit.
