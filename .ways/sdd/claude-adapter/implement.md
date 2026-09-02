# implement

Goal: Deliver the adapter per specify.md, with one scope adjustment requested by the human mid-work: bootstrap renders every registered provider from the canonical source by default (`--no-adapters` opts out); `ways adapter install` regenerates one.
Evidence: assets/adapters holds 8 commands, 7 roles (six-line limit enforced by the loader), statusline.sh and guard.sh. src/adapters/{types,source,claude,install}.ts render and install; PROVIDERS registry currently holds claude. Manifest schema/type gained `adapters`; integrity verifies adapter files (adapter-file-modified/missing); upgrade lists and re-renders them; CLI has `adapter list|install`. Claude settings.json is merged idempotently and not hashed. Installed in this repository as dogfood: statusline prints the live SDD phase, guard exits 2 on `git commit` when idle. tests/adapter.test.ts adds 7 tests; suite 52/52; scripts/check.sh passes.
Decision: Implementation complete.
Gate: Proceed to review.
