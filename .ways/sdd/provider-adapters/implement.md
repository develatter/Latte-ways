# implement

Goal: Ship Codex, Cursor and pi adapters and the README usage guide.
Evidence: src/adapters/{render,hook-file,codex,cursor,pi}.ts; PROVIDERS registers four providers; guard reads top-level command (Cursor), apply_patch and tool_input.path; tests cover rendering shapes, read-only markers, idempotent hook merges preserving user entries, integrity on removed guard, and each guard binary; adapters installed in this repo; README gains a day-to-day guide and a provider table; HANDOFF and acceptance updated. scripts/check.sh passes with 71 tests.
Decision: Implementation complete.
Gate: Proceed to review.
