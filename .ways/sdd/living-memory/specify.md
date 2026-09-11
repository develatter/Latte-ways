# specify

Goal: Freeze acceptance for porting living-memory onto master with master as harness truth.
Evidence: Explore inventory (24A/51 takes/12 hunk-applies/2 manual/32 keep/10 keep-deleted) plus API gaps (GitTreeEntry, validateCoverage, MemoryConfig, effectiveMemoryConfig).
Decision: Accept iff (1) 24 added files present and compiling (adjust only for master API renames, noted), (2) 51 dev-only takes applied except rendered adapters which are regenerated from canonical assets, (3) 12 disjoint hunks applied, (4) validation.ts conflict keeps both attempt validators and validateCoverage with merged tests, (5) none of the 10 harness files deleted and digest pinning/remediation/discovery intact, (6) typecheck + memory-targeted tests + full check.sh + history green, (7) no .ways ceremony transplanted from development.
Gate: Acceptance frozen; proceed to plan the port order.
