---
type: system
status: stable
generated: { by: process:baseline-discovery, at: 2026-09-03T00:00:00Z }
verified: { by: process:baseline-review, at: 2026-09-03T00:00:00Z }
sources:
  - { resource: /src, revision: 4723b5d6143f4da2fa4e84a144af5ef148953975 }
  - { resource: /assets, revision: 4723b5d6143f4da2fa4e84a144af5ef148953975 }
---

# Latte Ways architecture

Latte Ways is a Node.js CLI and library that combines Git-backed work state, deterministic gates, provider-neutral adapters, and OKF repository memory. Runtime implementation lives in `src/`; canonical installation and adapter resources live in `assets/`; `dist/` is generated and never authored.

Git is the immutable work log. JSON under `.ways/state/` is active workflow state, `.ways/status.json` is its derived observable projection, and OKF under `.ways/knowledge/` is durable current truth rather than progress history.
