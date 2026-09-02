---
type: plan
status: proposed
work: living-memory
---

# Goal

Make OKF the reliable living memory of the code shipped on the release branch. Agents build memory incrementally during development when durable facts change; a separately reviewed reconciliation certifies that the combined memory is complete and true for the exact code tree before it reaches `main` or `master`, without imposing ceremonial updates on trivial changes.

# Product contract

- Memory records durable architecture, component responsibilities, observable features and contracts, active decisions, conventions, and recurring operational knowledge.
- Progress, commit summaries, incidental implementation detail, branch-local state, and temporary execution plans are not memory.
- `roadmap` and `debt` are auxiliary OKF collections, explicitly distinguished from current truth and subject to freshness and closure rules.
- Removed concepts are deleted unless their removal remains operationally useful; those records move to `.ways/knowledge/deprecated/` with removal metadata and are excluded from normal queries.
- Memory updates are separate commits close to the implementation that motivated them. There is no mandatory update cadence per commit, task, quick, plan, or SDD phase.
- New or materially changed semantic claims require an independent, digest-bound review. Trivial changes require no empty document or expensive semantic pass.

# Branch models

## Integration branch

Repositories may configure an integration branch such as `development` or `next` and a release branch such as `main` or `master`.

1. Development and incremental memory updates proceed normally on feature branches and enter the integration branch.
2. Before release, create one ephemeral `reconcile/*` branch from an immutable integration snapshot.
3. Commits exclusive to that branch may touch only memory source files, coverage, reconciliation evidence, and related metadata.
4. Reconciliation verifies and repairs the combined incremental memory; it is a certification backstop, not the primary memory authoring stage.
5. A real merge commit brings the reconciliation branch into the release branch.
6. A real merge commit synchronizes the release branch back into the integration branch. A content watermark ensures this transport does not count covered code twice; code added after the snapshot remains honestly pending.
7. Only one reconciliation generation may publish at a time. Target movement, conflicting memory, or a changed code tree invalidates the certification.

## Trunk-based

Repositories without an integration branch reconcile the candidate branch against the current release target. A target change invalidates the certification and requires reconciliation of the new delta before merge.

# Plan

1. Define the memory model and schemas.
   - Add canonical records for source references, source globs, reviewed code-tree watermark, reconciliation generation, coverage areas, and reconciliation evidence.
   - Add first-class active collections plus `roadmap`, `debt`, and `deprecated` lifecycle rules.
   - Bind local sources to existing paths/globs and the code-tree revision at which claims were reviewed.
2. Replace tracked derived indexes with an on-demand cache.
   - Stop versioning `.ways/indexes/` and migrate existing repositories safely.
   - Generate catalog, graph, and search indexes automatically when missing or stale.
   - Make `ways query` consume the search index and filter deprecated records by default while clearly labelling drafts, roadmap, and debt.
3. Implement initial discovery and coverage.
   - Make every bootstrap open a required discovery workflow, including greenfield repositories where the result may be empty.
   - Produce a sharded coverage map that classifies relevant areas as concept-backed, implementation detail, or cosmetic/derived.
   - Require independent review before establishing the initial watermark.
   - Provide an explicitly requested full rediscovery operation; never trigger it as automatic repair.
4. Implement incremental memory support without mode-based ceremony.
   - Add a supported memory-commit operation that runs inside active work and creates a separate traced commit linked to the motivating implementation range.
   - Teach agents to assess durable semantic impact progressively and update memory near the relevant development milestone.
   - Use configurable relevant-path rules and conservative risk signals: public API/CLI/schema changes, module additions/removals/renames, dependencies, migrations, source intersections, and broad cross-area changes.
   - Keep no-impact changes cheap; do not require authored artifacts merely because a quick or plan closed.
5. Implement release reconciliation.
   - Add a provider-agnostic workflow that snapshots the relevant code tree, computes a canonical content digest, groups the accumulated diff by traced work, and finds concepts/coverage areas whose sources intersect it.
   - Require explicit disposition of every candidate and detect uncovered additions, removed sources, contradictions, and stale active claims.
   - Require a digest-bound independent review for semantic impact and fail closed on unresolved claims.
   - Preserve compact reconciliation manifests in Git as audit evidence.
6. Enforce branch topology and publication safety.
   - Support configurable release and optional integration branch names plus an ephemeral reconciliation branch pattern.
   - Verify ancestry, snapshot identity, single-writer generation, allowlisted reconciliation paths, and real merge commits in both publication and back-sync directions.
   - Make CI validate the proposed merge tree and reject stale, rebased, squashed, cherry-picked, concurrent, or otherwise mismatched certification.
   - Document branch protection as a required external control; CI alone cannot prevent an unauthorized direct push before it lands.
7. Make freshness visible outside the release branch.
   - Compare the working branch's relevant code-tree digest with the covered watermark.
   - Let queries return useful memory while prominently warning when later code may affect it and naming the potentially affected areas.
   - Keep the release branch fail-closed and fully reconciled.
8. Update canonical bootstrap templates and provider adapters, then regenerate managed files.
   - Explain discovery, incremental authoring, semantic review, reconciliation, pruning, and explicit rediscovery without exceeding adapter prompt limits.
   - Remove or redefine the currently ceremonial SDD reconcile gate and the ineffective quick/plan memory disposition only as required by the new incremental protocol; do not silently discard their intent.
9. Migrate and baseline this repository.
   - Perform the one-time full discovery manually through the new workflow rather than adding a product command dedicated to this repository.
   - Build and independently review its system, component, feature, convention, decision, roadmap, debt, and coverage records.
10. Add adversarial tests and operational documentation.
   - Cover greenfield and existing bootstrap, incremental updates, trivial changes, parallel concept edits, stale target invalidation, true merge publication, forbidden squash/rebase/cherry-pick, concurrent generations, conflict resolution, master-to-integration sync, query warnings, pruning, manual correction, forced rediscovery, and deterministic cache generation.
   - Test from a packed consumer installation and run the canonical checks.

# Non-goals

- Automatically generating semantic truth from diffs without agent review.
- Requiring memory changes for every code change or workflow completion.
- Treating roadmap, debt, drafts, or deprecated records as current verified truth.
- Language-specific symbol indexing or fragile line-number references in the first version.
- Provider-specific agent launching in the core package.
- Storing progress or release notes in OKF.

# Acceptance

1. Bootstrap cannot complete until a reviewed discovery and coverage baseline is established; a greenfield baseline may contain no concepts.
2. A user can explicitly request full rediscovery, but no check, repair, or agent workflow invokes it implicitly.
3. An agent can create a separate, traced memory commit during development, linked to the implementation range it describes, without requiring every trivial change to do so.
4. Existing local sources and configured globs are validated, active claims carry a reviewed code-tree watermark, and deleted or invalid sources fail checks.
5. Parallel branches modifying unrelated concepts do not conflict through generated indexes; indexes are untracked, deterministic, and rebuilt automatically.
6. A release merge is rejected unless reviewed reconciliation evidence matches the exact relevant code tree that would land on the configured release branch.
7. Reconciliation branches reject exclusive changes outside the strict memory allowlist, and publication/back-sync reject non-merge integration strategies.
8. Concurrent or stale reconciliation generations fail closed; conflict resolutions cannot bypass content and review digests.
9. Synchronizing the release branch back into integration does not reclassify already covered code as drift, while later integration changes remain visible as pending.
10. `ways query` uses derived search data, excludes deprecated records by default, labels auxiliary/unverified material, and warns when the current branch is ahead of its memory watermark.
11. Semantic updates and manual corrections require independent review; unresolved impact cannot reach the release branch.
12. The repository receives a reviewed one-time baseline, all focused tests pass, `scripts/check.sh` passes, and the worktree is clean.
