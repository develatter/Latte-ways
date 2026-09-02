import { resolveWith, SLASH_NAMES, yamlFrontmatter } from "./render.js";
import type { AdapterSource, ProviderAdapter, RenderedFile } from "./types.js";

/**
 * pi coding agent (`@earendil-works/pi-coding-agent`). Per the upstream docs
 * (2026-09): commands become prompt templates in `.pi/prompts/<name>.md`
 * (frontmatter `description`, `argument-hint`; `$ARGUMENTS` supported), roles
 * become `.pi/agents/<name>.md` for the subagent extension with a `tools`
 * restriction for read roles, and the guard plus the status line run from a
 * project extension in `.pi/extensions/ways/index.ts` through `pi.on("tool_call")`
 * (returning `{ block, reason }`) and `ctx.ui.setStatus`. Project resources load
 * only once the project is trusted.
 */
export const PI_DIR = ".pi";
const GUARD_PATH = `${PI_DIR}/ways-guard.sh`;
const STATUSLINE_PATH = `${PI_DIR}/ways-statusline.sh`;
const READ_TOOLS = "read, grep, find, ls";

const EXTENSION = `// Managed by latte-ways. Guard and status line for pi, both backed by the harness scripts.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const GUARD = "${GUARD_PATH}";
const STATUSLINE = "${STATUSLINE_PATH}";

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
`;

export function renderPi(source: AdapterSource): RenderedFile[] {
  const files: RenderedFile[] = [];
  for (const command of source.commands) {
    const front = yamlFrontmatter([["description", command.description], ["argument-hint", command.usage]]);
    files.push({ path: `${PI_DIR}/prompts/ways-${command.name}.md`, content: `${front}\n${resolveWith(command.body, SLASH_NAMES)}\n` });
  }
  for (const role of source.roles) {
    const front = yamlFrontmatter([["name", `ways-${role.name}`], ["description", role.description], ["tools", role.access === "read" ? READ_TOOLS : undefined]]);
    files.push({ path: `${PI_DIR}/agents/ways-${role.name}.md`, content: `${front}\n${resolveWith(role.body, SLASH_NAMES)}\n` });
  }
  files.push({ path: `${PI_DIR}/extensions/ways/index.ts`, content: EXTENSION });
  files.push({ path: STATUSLINE_PATH, content: resolveWith(source.statusline, SLASH_NAMES), mode: 0o755 });
  files.push({ path: GUARD_PATH, content: resolveWith(source.guard, SLASH_NAMES), mode: 0o755 });
  return files;
}

export const piAdapter: ProviderAdapter = {
  id: "pi",
  render: renderPi,
};
