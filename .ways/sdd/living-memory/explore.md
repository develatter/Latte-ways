# explore

Goal: Map the current implementation and identify safe extension points for trustworthy incremental memory and release certification.
Evidence: Four independent explorations found reusable Git execution/ancestry, deterministic hashing/serialization, OKF parsing, digest-bound reviews, worktrees, and adapter rendering; they also confirmed absent discovery, coverage, source revision checks, code-tree watermarks, branch topology, reconciliation generations, merge-aware history, lazy indexes, and packed-consumer coverage. Current reconcile-memory and quick/plan dispositions are ceremonial. See cited source paths in the exploration reports and source-plan.md.
Decision: Build in dependency order: schemas/digests and migration foundation; lazy untracked indexes/query; discovery and incremental memory workflow; release reconciliation/topology; adapters/bootstrap; repository baseline and adversarial tests. Preserve provider-neutral core and treat host branch protection/merge queues as explicit external requirements.
Gate: Exploration is sufficient to assess feasibility and risks; proceed to assessment without implementation.
