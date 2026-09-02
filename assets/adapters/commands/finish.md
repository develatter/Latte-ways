---
description: Close the active quick or plan work with checks and one traced commit
usage: <commit message>
---
Run `scripts/check.sh`. If it fails, fix the cause first; never bypass. Then run `npx ways quick finish --message="$ARGUMENTS" --memory=<updated|unchanged>` or the `plan finish` equivalent, choosing `updated` only if you changed `.ways/knowledge/`. Report the commit hash.
