---
name: ways-status
description: Show the active harness work, mode and phase
---

Run `npx ways status --json` and summarise mode, id, phase, profile and whether a human gate is pending. When `attempt` and `remediation` are present, report the reopened attempt and its source/target/reason. If nothing is active, say so and list the ways to open work: $ways-quick, $ways-plan, $ways-sdd. Closing, cancelling and advancing are done by you through the CLI, never by the human.
