# specify

Goal: Specify files per provider.
Evidence: codex: .agents/skills/ways-<cmd>/SKILL.md, .codex/agents/ways-<role>.toml, .codex/ways-guard.sh, merge .codex/hooks.json PreToolUse matchers Bash and apply_patch|Edit|Write. cursor: .cursor/skills/ways-<cmd>/SKILL.md (disable-model-invocation), .cursor/agents/ways-<role>.md (readonly), .cursor/ways-guard.sh, merge .cursor/hooks.json version 1 with beforeShellExecution and preToolUse matcher Write, failClosed. pi: .pi/prompts/ways-<cmd>.md, .pi/agents/ways-<role>.md (tools: read, grep, find, ls), .pi/ways-guard.sh, .pi/ways-statusline.sh, .pi/extensions/ways/index.ts (tool_call guard, setStatus from statusline). Guard learns apply_patch and tool_input.path. Name resolution per provider: commands $ways-x (codex) or /ways-x (cursor, pi); $ARGUMENTS kept for pi, spelled out for skills. verify() checks guard presence in merged hook files. README gains a usage guide.
Decision: Specified.
Gate: Proceed.
