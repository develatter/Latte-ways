# Ways

- Read `README.md` and `MAP.md`; run `npx ways status` before mutation.
- Obey the active mode and state. Never skip, forge, or edit a gate.
- In this package, change `src/`, `assets/`, and `tests/`; never edit `dist/`.
- Keep commits atomic and run `scripts/check.sh` before completion.
- Reconcile durable facts with `.ways/knowledge/`; do not store progress there.
- Change managed files through their source templates, then regenerate them.
