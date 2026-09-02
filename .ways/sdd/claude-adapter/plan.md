# plan

Goal: Implementation order.
Evidence: Contracts in specify.md.
Decision:
1. Assets: commands, roles, statusline.sh, guard.sh.
2. src/adapters: types, source loader with six-line check, claude renderer, installer; manifest type and schema.
3. Integrity and upgrade extensions; CLI.
4. Tests (tests/adapter.test.ts) and docs; install in this repo.
Gate: Proceed to decompose.
