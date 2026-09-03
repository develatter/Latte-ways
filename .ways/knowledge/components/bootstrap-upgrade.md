---
type: component
status: stable
generated: { by: process:baseline-discovery, at: 2026-09-03T00:00:00Z }
verified: { by: process:baseline-review, at: 2026-09-03T00:00:00Z }
sources:
  - { resource: /src/bootstrap, revision: 4723b5d6143f4da2fa4e84a144af5ef148953975 }
  - { resource: /src/upgrade, revision: 4723b5d6143f4da2fa4e84a144af5ef148953975 }
---

# Bootstrap and upgrade

Bootstrap installs the repository contract from packaged assets, configures the managed commit hook, renders all adapters, and opens mandatory reviewed discovery. Upgrade applies versioned migrations and compares manifest hashes before replacing managed files; divergent managed content requires explicit approval.
