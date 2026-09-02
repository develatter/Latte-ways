---
description: Discover, author, and reconcile durable repository memory
argument-hint: <discovery|commit|reconcile> ...
---

Use `npx ways memory discovery request` only for bootstrap or an explicitly requested `--rediscover`; obtain its digest, delegate independent review, then complete it with the review JSON.
When durable semantics change during active work, commit implementation first, run `npx ways memory commit digest --implementation=<from>..<to>`, delegate review, then create the separate traced memory commit; trivial changes need no memory artifact.
Before release, use `npx ways memory reconcile inspect <request.json>`, independently review the reported digest, then validate evidence, the real publication merge, and (for integration profiles) the real back-sync merge.
Never invent semantic truth, treat generated indexes as authored files, or launch provider-specific agents through the core CLI.
