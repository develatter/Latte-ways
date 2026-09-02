// Managed by latte-ways. Guard and status line for pi, both backed by the harness scripts.
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const GUARD = ".pi/ways-guard.sh";
const STATUSLINE = ".pi/ways-statusline.sh";
const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

function runScript(script: string, payload: unknown): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("sh", [join(ROOT, script)], { input: JSON.stringify(payload), encoding: "utf8" });
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? result.error?.message ?? "" };
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
    if (result.code !== 0) return { block: true, reason: result.stderr.trim() || "ways guard failed; blocking tool use" };
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
