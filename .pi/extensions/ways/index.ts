// Managed by latte-ways. Guard and status line for pi, both backed by the harness scripts.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const GUARD = ".pi/ways-guard.sh";
const STATUSLINE = ".pi/ways-statusline.sh";

function runScript(script: string, payload: unknown): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("sh", [join(process.cwd(), script)], { input: JSON.stringify(payload), encoding: "utf8" });
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event) => {
    const cwd = process.cwd();
    const input = (event.input ?? {}) as Record<string, unknown>;
    let payload: unknown;
    if (event.toolName === "bash") payload = { tool_name: "Bash", tool_input: { command: String(input.command ?? "") }, cwd };
    else if (event.toolName === "edit" || event.toolName === "write" || event.toolName === "multi_edit") payload = { tool_name: "Write", tool_input: { file_path: String(input.path ?? "") }, cwd };
    else return undefined;
    const result = runScript(GUARD, payload);
    if (result.code === 2) return { block: true, reason: result.stderr.trim() || "blocked by the ways guard" };
    return undefined;
  });

  const refresh = async (_event: unknown, ctx: { hasUI: boolean; ui: { setStatus(key: string, text: string): void } }) => {
    if (!ctx.hasUI) return;
    const result = runScript(STATUSLINE, { cwd: process.cwd() });
    ctx.ui.setStatus("ways", result.stdout.trim());
  };
  pi.on("session_start", refresh);
  pi.on("turn_start", refresh);
  pi.on("tool_result", async (event, ctx) => {
    await refresh(event, ctx);
    return undefined;
  });
}
