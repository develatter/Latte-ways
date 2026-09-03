# Living memory operations

Latte Ways keeps durable repository truth in OKF under `.ways/knowledge/`. Current system, component, feature, convention, decision, and FAQ records are distinct from the explicitly labelled `roadmap` and `debt` collections. Removed facts are deleted unless they remain operationally useful; useful history moves to `deprecated` and is omitted from normal query results.

## Development

Bootstrap creates a pending discovery request. An independent reviewer must review the discovery digest before `ways memory discovery complete` establishes generation zero. Full rediscovery is only initiated by `ways memory discovery request --rediscover`; checks and repairs never invoke it.

When implementation changes durable semantics, commit implementation first. Author memory near that milestone, review `ways memory commit digest --implementation=<from>..<to>` independently, then use `ways memory commit create`. The resulting memory commit is separate and traced to its motivating range. Cosmetic and implementation-only work needs no empty memory artifact.

`ways query` rebuilds missing or stale untracked indexes. It excludes deprecated records, labels drafts, roadmap, and debt, and warns when relevant content differs from the reviewed watermark.

## Release reconciliation

For the integration profile, create `reconcile/<generation>` from an immutable integration snapshot. Exclusive commits on that branch may only alter memory source, coverage, and reconciliation evidence. Disposition every relevant path changed since the published watermark, resolve contradictory or stale claims, and independently review the exact reconciliation digest.

Validate in this order:

1. `ways memory reconcile inspect request.json --output=evidence.json`
2. `ways memory reconcile validate evidence.json --state=.ways/knowledge/state.json --reconcile=<sha> --target=<release-ref> --unresolved-claims='[]'`
3. create a real two-parent merge into the release branch and run `ways memory reconcile publication ...`
4. create a real release-to-integration merge and run `ways memory reconcile back-sync ...`

Candidate checks and landed-tree checks are separate. The latter detects conflict-resolution changes. Squash, rebase, cherry-pick, moving targets, concurrent generations, and altered reconciliation tips invalidate evidence. A content watermark means a back-sync does not count covered code twice; integration work after the snapshot remains drift.

See [branch protection](BRANCH_PROTECTION.md) for provider-neutral external controls and CI inputs.
