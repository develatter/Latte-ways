#!/usr/bin/env sh
# Managed by latte-ways. Blocks agent-issued git commits when no harness work is active.
input="$(cat)"
case "$input" in *commit*) ;; *) exit 0 ;; esac
command -v node >/dev/null 2>&1 || { echo "ways: node not found; refusing to run git commit without the guard" >&2; exit 2; }
printf '%s' "$input" | exec node -e '
let data = "";
process.stdin.on("data", (chunk) => { data += chunk; }).on("end", () => {
  let command = "";
  try { command = String(JSON.parse(data).tool_input?.command ?? ""); } catch { process.exit(0); }
  const option = "(?:-[^\\s]+\\s+(?:[^-\\s][^\\s]*\\s+)?)*";
  const prefix = "(?:(?:command|exec|builtin)\\s+|[^\\s;&|(`]*/)?";
  const commits = new RegExp("(?:^|[;&|(`\\x22\\x27]\\s*|\\$\\(\\s*)" + prefix + "git\\s+" + option + "commit(?:\\s|$)", "m");
  if (!commits.test(command)) process.exit(0);
  const { execFileSync } = require("node:child_process");
  const { existsSync, readFileSync } = require("node:fs");
  let root;
  try { root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { process.exit(0); }
  const file = `${root}/.ways/status.json`;
  if (!existsSync(file)) process.exit(0);
  let status;
  try { status = JSON.parse(readFileSync(file, "utf8")); } catch { process.exit(0); }
  if (status.active === false) {
    process.stderr.write("ways: no active work; open one with /ways-quick, /ways-plan or /ways-sdd before committing\n");
    process.exit(2);
  }
  process.exit(0);
});
'
