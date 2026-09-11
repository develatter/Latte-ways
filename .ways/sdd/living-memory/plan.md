# plan

Goal: Order the port so every step compiles against what is already in place.
Evidence: API gap chain (types/constants -> git -> canonical adapters -> memory core -> validation conflict -> wiring/cli -> tests -> regenerate -> verify).
Decision: Execute in 6 waves: (1) foundation takes+ hunks: types.ts, constants.ts, config.ts, git.ts; typecheck. (2) canonical adapter sources (assets/adapters/** takes + memory.md add; no rendered output yet). (3) memory core adds: src/memory/*, schemas (memory-*, coverage take), knowledge takes, query/bootstrap/plan/quick/index takes. (4) conflict resolutions: domain/validation.ts (both validators + validateCoverage) and tests/validation.test.ts merge; cli.ts hunks. (5) test adds/takes/hunk-applies (incl. adapter/git tests), README/docs/.gitignore. (6) regenerate adapters via CLI, typecheck, targeted memory tests, full check.sh + history. Each wave verified before the next; stop on divergence.
Gate: Order fixed; proceed to decompose into inline tasks.
