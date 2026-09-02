# specify

Goal: Freeze an implementable contract for living memory without adding mode- or task-based ceremony.
Evidence: source-plan.md is the approved product specification; exploration established the current gaps and reusable primitives. The user clarified that incremental memory is the winning path for long-lived branches, memory commits are separate from implementation commits, and release reconciliation verifies rather than normally constructing memory.
Decision: Implement the following contract.
Gate: The requirements below are specific enough for decomposition and machine/adversarial verification.

## Required behavior

1. Bootstrap always leaves a required discovery baseline, including greenfield repositories; full rediscovery after bootstrap requires an explicit user request.
2. Active OKF contains durable current facts. Roadmap and debt are clearly auxiliary. Removed facts are pruned or moved to deprecated history, which normal query excludes.
3. Coverage is sharded by area/glob and records concept-backed, implementation-detail, or derived/cosmetic classification without permanently exempting future changes.
4. Agents may create separate traced memory commits near implementation milestones. No fixed cadence is imposed and trivial changes require no authored no-op artifact.
5. Sources use repository paths/globs and reviewed revisions; active source paths must resolve. Semantic changes and corrections require independent digest-bound review.
6. Derived indexes are ignored caches, rebuilt deterministically and automatically; query consumes search data, labels non-current material, and warns when the current relevant code tree differs from the memory watermark.
7. Release reconciliation computes a canonical digest of configurable relevant code content, evaluates the cumulative snapshot against incremental memory, dispositions every candidate, preserves compact evidence, and fails closed on omissions, contradictions, stale sources, unresolved claims, target movement, or stale review.
8. Integration profile supports configurable integration/release branches and ephemeral reconcile/* branches. Only memory-source/coverage/evidence paths may change after the integration snapshot. Publication and release-to-integration sync must be real merge commits; already covered code transported by sync is not drift, while later integration changes remain pending.
9. Trunk profile has no integration branch; candidates reconcile against the current release target and become stale when it moves.
10. Reconciliation generations publish serially via compare-and-swap semantics. Remote branch protection and merge queues remain documented external prerequisites.
11. Legacy state/history remains readable through a versioned, idempotent migration; do not reinterpret old reconcile-memory certifications.
12. Provider adapters remain generated from canonical assets, role bodies stay within six non-empty lines, and the core never launches provider-specific agents.

## Verification boundary

- Canonical digests hash normalized relevant path, file mode/type, and bytes, independent of commit identity and excluded memory/cache paths.
- Candidate and landed-merge validation are distinct and accept explicit refs/SHAs for CI portability.
- Final merged-tree validation includes conflict resolutions; ancestry alone is insufficient.
- Required tests cover missing/stale/read-only cache, bootstrap interruption and greenfield discovery, source/glob validation, parallel branches, stale targets, concurrent generations, merge parent/order, forbidden non-merge strategies, back-sync idempotence, post-snapshot drift, manual correction, rediscovery, and packed consumers.
