# Repository map

- Product overview and commands: `README.md`
- Planned milestones: `docs/ROADMAP.md`
- Next-agent context and current caveats: `docs/HANDOFF.md` when present
- Runtime implementation: `src/`
- Bootstrap templates and schemas: `assets/`
- Automated verification: `tests/`
- Harness configuration and state: `.ways/config.json`, `.ways/state/`, derived `.ways/status.json`
- Managed Git hooks: `.ways/hooks/`
- Provider adapters rendered from the harness canonical source: `.claude/` and siblings
- Plans and active SDD artifacts: `.ways/plans/`, `.ways/sdd/`
- Current OKF knowledge and indexes: `.ways/knowledge/`, `.ways/indexes/`
- Canonical local and CI check: `scripts/check.sh`
