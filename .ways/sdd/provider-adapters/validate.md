# validate

Goal: Validate provider adapter fixes and regenerated managed artifacts.
Evidence: `npm test -- --run tests/adapter.test.ts` (15 passing) and `scripts/check.sh` (72 passing, integrity and history checks passed) after regeneration.
Decision: Pass.
Gate: Advance to reconcile-memory.
