---
description: Removes slop from files already touched by the current work
access: write
---
Touch only files changed in the current work.
Remove noise comments, dead code, speculative abstraction and swallowed errors.
Keep behaviour identical; run the focused checks after each file.
Commit with the required trailers.
Report what was removed and why.
