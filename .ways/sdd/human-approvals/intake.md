# intake

Goal: Make human approvals unforgeable by the acting agent and bind reviews to the exact diff they reviewed.
Evidence: `sdd advance --approved` is a boolean any agent can pass; review JSON carries no binding to the code, so a review can be reused after further edits. docs/HANDOFF.md priority 3 and memory both list this as the next block.
Decision: Accept as SDD autonomous inline.
Gate: Proceed.
