#!/usr/bin/env sh
# Managed by latte-ways. Blocks agent-issued git commits when no harness work is active,
# blocks file edits in the main worktree while a delegated SDD implement phase is running,
# and blocks any tool write to human approvals or review verdicts.
input="$(cat)"
case "$input" in *commit*|*Edit*|*Write*|*apply_patch*|*approvals*|*reviews*) ;; *) exit 0 ;; esac
command -v node >/dev/null 2>&1 || { echo "ways: node not found; refusing to run git commit without the guard" >&2; exit 2; }
printf '%s' "$input" | exec node -e '
let data = "";
process.stdin.on("data", (chunk) => { data += chunk; }).on("end", () => {
  let event;
  try { event = JSON.parse(data); } catch { process.exit(0); }
  const tool = String(event.tool_name ?? "");
  const command = String(event.tool_input?.command ?? event.command ?? "");
  const edits = /^(Edit|Write|MultiEdit|NotebookEdit|apply_patch)$/.test(tool);
  const option = "(?:-[^\\s]+\\s+(?:[^-\\s][^\\s]*\\s+)?)*";
  const prefix = "(?:(?:command|exec|builtin)\\s+|[^\\s;&|(`]*/)?";
  const commits = new RegExp("(?:^|[;&|(`\\x22\\x27]\\s*|\\$\\(\\s*)" + prefix + "git\\s+" + option + "commit(?:\\s|$)", "m");
  const evidence = /\.ways\/sdd\/[^\/\s]+\/(approvals|reviews)(\/|$)/;
  const edited = event.tool_input?.file_path ?? event.tool_input?.notebook_path ?? event.tool_input?.path;
  const patch = String(event.tool_input?.patch ?? event.tool_input?.input ?? "");
  const patchPaths = [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm)].map((match) => match[1] ?? match[2]);
  const targetPath = typeof edited === "string" ? edited : patchPaths[0];
  const writes = /(>|\b(tee|cp|mv|rm|ln|dd|touch|install|rsync|python3?|node|perl|ruby)\b|\bsed\b[^|;&]*\s-[a-zA-Z]*i)/;
  if ((edits && ((typeof edited === "string" && evidence.test(edited)) || patchPaths.some((path) => evidence.test(path)))) || (!edits && evidence.test(command) && writes.test(command))) {
    process.stderr.write("ways: approvals and review verdicts are written only by `ways approve` and `ways review submit`\n");
    process.exit(2);
  }
  if (!edits && !commits.test(command)) process.exit(0);
  const { execFileSync } = require("node:child_process");
  const { existsSync, readFileSync } = require("node:fs");
  const { dirname, resolve } = require("node:path");
  let target = edits && typeof targetPath === "string" ? dirname(resolve(String(event.cwd ?? process.cwd()), targetPath)) : String(event.cwd ?? process.cwd());
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
    process.stderr.write("ways: no active work; open one with $ways-quick, $ways-plan or $ways-sdd before committing\n");
    process.exit(2);
  }
  process.exit(0);
});
'
