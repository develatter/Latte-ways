# explore

Goal: Locate every point where approvals and reviews are decided.
Evidence: src/work/sdd.ts advanceSdd(approved) with HUMAN_GATES from src/state/status.ts; src/work/review.ts submitReview/assertReviewPassed with reviews/latest.json; src/hooks/hook.ts judges commits by disk/HEAD state; assets/adapters/guard.sh blocks tool writes; assets/schemas/review.schema.json has no digest; commands/sdd.md tells agents never to pass --approved.
Decision: The mechanical seams are advance, submit, the commit-msg hook and the guard.
Gate: Proceed.
