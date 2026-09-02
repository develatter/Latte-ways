# validate

Goal: Prove acceptance from source-plan.md.
Evidence: This repository runs the adapter live: the slash commands /ways-* are listed by Claude Code, the statusline prints the SDD phase, and the PreToolUse guard intercepted this session's own Bash calls (a broken guard build was caught by it during implementation). Bootstrap on a fresh repo renders 17 files for claude; tampering fails integrity with adapter-file-modified; upgrade re-renders after checklist approval. No role prompt exceeds six lines (loader-enforced). Claude-specific strings live only in src/adapters/claude.ts. scripts/check.sh passes with 55 tests.
Decision: Acceptance met.
Gate: Proceed to reconcile-memory.
