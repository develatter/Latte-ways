# specify

Goal: Specify artifacts and rules.
Evidence: Approval file `.ways/sdd/<id>/approvals/<phase>.json` {schemaVersion, workId, phase, gateCommit, digest, approvedBy, approvedAt}; schema approval.schema.json. Digest = sha256 over `git diff --binary <gateCommit>` plus untracked files (path+sha), excluding approvals/, reviews/ and status.json. `ways approve` (TTY only) writes it; `sdd advance` drops --approved and validates the artifact; review.schema requires `digest`; `ways review digest` prints it; submit and advance verify. Hook: certification of a HUMAN_GATES phase under supervised profile requires the artifact staged and consistent. Guard: block Edit/Write under approvals|reviews and Bash commands naming those paths.
Decision: Specified.
Gate: Proceed.
