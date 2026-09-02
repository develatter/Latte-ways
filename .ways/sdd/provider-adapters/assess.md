# assess

Goal: Decide rendering strategy per provider.
Evidence: All three reuse the same guard.sh through a JSON-on-stdin contract (Codex and Cursor natively, Pi through a thin extension that shells out). Commands become skills where prompts are unsupported (Codex, Cursor) and prompt templates where supported (Pi). Roles become provider agent files with the provider's read-only marker. Shared hook files (.codex/hooks.json, .cursor/hooks.json) are merged idempotently like .claude/settings.json.
Decision: Keep SDD; three adapters plus README usage guide in one work.
Gate: Proceed.
