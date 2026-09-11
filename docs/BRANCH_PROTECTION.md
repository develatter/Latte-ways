# Branch protection and CI contract

Local validation proves content and topology; it cannot stop an authorized or unauthorized direct push. Configure equivalent controls in the hosting provider for the configured release branch (`master` here) and integration branch (`development`). Product names differ, but the policy is provider-neutral.

## Required external controls

- deny direct pushes and force pushes; require pull/merge requests;
- require `scripts/check.sh` on the exact proposed merge commit with complete Git history;
- require the reconciliation candidate, evidence, publication, and back-sync validations described below;
- require the independent semantic reviewer and dismiss approval when content changes;
- serialize reconciliation publication with a merge queue or equivalent single-writer lock;
- require real merge commits and disable squash/rebase for reconciliation publication and release-to-integration back-sync;
- restrict branch deletion and administration bypasses, and audit emergency overrides.

## Provider-neutral CI inputs

CI must fetch full history and invoke the package CLI from the checked-out candidate. Supply immutable SHAs rather than assuming local branch names:

```sh
scripts/check.sh
ways memory reconcile validate "$EVIDENCE" \
  --state="$MEMORY_STATE" --reconcile="$RECONCILE_SHA" \
  --target="$RELEASE_SHA" --unresolved-claims='[]'
ways memory reconcile publication "$EVIDENCE" \
  --publication="$PUBLICATION_SHA" --reconcile="$RECONCILE_SHA"
ways memory reconcile back-sync --publication="$PUBLICATION_SHA" \
  --integration-before="$INTEGRATION_BEFORE_SHA" --back-sync="$BACK_SYNC_SHA"
```

Run candidate validation before merge, publication validation on the landed release merge, and back-sync validation on the landed integration merge. A generic CI system can map its event variables to these inputs. The checked-out publication must have the release target as first parent and reconciliation tip as second parent; back-sync must have the prior integration tip first and publication second.

The repository's GitHub workflow is one adapter to this contract. Required-check rules, reviewer identity, merge strategy, and serialization remain host configuration and cannot be guaranteed by workflow YAML alone.
