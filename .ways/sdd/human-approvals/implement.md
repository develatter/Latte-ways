# implement

Goal: Ship TTY-gated, digest-bound approvals and digest-bound reviews.
Evidence: New src/work/digest.ts, src/work/approve.ts, assets/schemas/approval.schema.json; advanceSdd drops --approved and calls assertApproved; review schema requires digest, `ways review digest` added, submit and gate recompute; hook refuses human-gate certifications without a bound approval and closing commits without the committed close approval; guard blocks tool writes to approvals/ and reviews/. tests/approval.test.ts plus updated suites; scripts/check.sh passes with 65 tests. `ways approve` verified live to refuse without TTY.
Decision: Implementation complete.
Gate: Proceed to review.
