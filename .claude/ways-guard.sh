#!/usr/bin/env sh
# Managed by latte-ways. Blocks agent-issued git commits when no harness work is active,
# and blocks file edits in the main worktree while a delegated SDD implement phase is running.
input="$(cat)"
case "$input" in *commit*|*Edit*|*Write*) ;; *) exit 0 ;; esac
command -v node >/dev/null 2>&1 || { echo "ways: node not found; refusing to run git commit without the guard" >&2; exit 2; }
printf '%s' "$input" | exec node -e '
let data = "";
process.stdin.on("data", (chunk) => { data += chunk; }).on("end", () => {
  let event;
  try { event = JSON.parse(data); } catch { process.exit(0); }
  const tool = String(event.tool_name ?? "");
  const command = String(event.tool_input?.command ?? "");
  const edits = /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool);
  const option = "(?:-[^\\s]+\\s+(?:[^-\\s][^\\s]*\\s+)?)*";
  const prefix = "(?:(?:command|exec|builtin)\\s+|[^\\s;&|(`]*/)?";
  const commits = new RegExp("(?:^|[;&|(`\\x22\\x27]\\s*|\\$\\(\\s*)" + prefix + "git\\s+" + option + "commit(?:\\s|$)", "m");
  if (!edits && !commits.test(command)) process.exit(0);
  const { execFileSync } = require("node:child_process");
  const { existsSync, readFileSync } = require("node:fs");
  const { dirname, resolve } = require("node:path");
  const edited = event.tool_input?.file_path ?? event.tool_input?.notebook_path;
  let target = edits && typeof edited === "string" ? dirname(resolve(String(event.cwd ?? process.cwd()), edited)) : String(event.cwd ?? process.cwd());
  while (!existsSync(target) && dirname(target) !== target) target = dirname(target);
  let root;
  try { root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: target, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { process.exit(0); }
  const file = `${root}/.ways/status.json`;
  if (!existsSync(file)) process.exit(0);
  let status;
  try { status = JSON.parse(readFileSync(file, "utf8")); } catch { process.exit(0); }
  if (edits) {
    if (existsSync(`${root}/.ways/runtime/task.json`)) process.exit(0);
    if (status.mode === "sdd" && status.execution === "delegated" && status.phase === "implement") {
      process.stderr.write("ways: delegated execution; the orchestrator must not edit code. Prepare a task worktree and delegate to ways-implementer\n");
      process.exit(2);
    }
    process.exit(0);
  }
  if (status.active === false) {
    process.stderr.write("ways: no active work; open one with /ways-quick, /ways-plan or /ways-sdd before committing\n");
    process.exit(2);
  }
  process.exit(0);
});
'
