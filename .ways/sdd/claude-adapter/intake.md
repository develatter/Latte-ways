# intake

Goal: Claude Code adapter rendered from a neutral source, per source-plan.md, so the human never touches the CLI.
Evidence: No adapter exists; assets/bootstrap/agents holds four prompts; manifest tracks only bootstrap files. Claude formats confirmed from docs: .claude/commands/*.md with description frontmatter and $ARGUMENTS, .claude/agents/*.md with name/description/tools/permissionMode, project-level .claude/settings.json with statusLine and PreToolUse hooks.
Decision: Accept the five-step plan. Approvals and reviewer digest binding remain out of scope.
Gate: Proceed to explore.
