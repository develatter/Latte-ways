import { isObject, mergeHookFile, verifyHookFile, type HookEntry } from "./hook-file.js";
import { renderSkill, resolveWith, type NameStyle } from "./render.js";
import type { AdapterSource, ProviderAdapter, RenderedFile } from "./types.js";

/**
 * OpenAI Codex CLI. Per the official docs (learn.chatgpt.com/docs, 2026-09):
 * project prompts are not supported, so commands become repository skills in
 * `.agents/skills/<name>/SKILL.md` invoked with `$name`; roles become
 * `.codex/agents/<name>.toml` with `sandbox_mode = "read-only"` for read roles;
 * the guard is a `PreToolUse` hook in `.codex/hooks.json` (JSON on stdin,
 * exit 2 denies). Project hooks and config load only in trusted projects.
 */
export const CODEX_DIR = ".codex";
const SKILLS_DIR = ".agents/skills";
const GUARD_PATH = `${CODEX_DIR}/ways-guard.sh`;
const HOOKS_PATH = `${CODEX_DIR}/hooks.json`;
const GUARD_COMMAND = `"$(git rev-parse --show-toplevel)"/${GUARD_PATH}`;
const NAMES: NameStyle = { command: (name) => `$ways-${name}`, role: (name) => `ways-${name}` };

const GUARD_HOOKS: Record<string, HookEntry[]> = {
  PreToolUse: [
    { matcher: "Bash", hooks: [{ type: "command", command: GUARD_COMMAND, statusMessage: "ways guard", timeout: 30 }] },
    { matcher: "apply_patch|Edit|Write", hooks: [{ type: "command", command: GUARD_COMMAND, statusMessage: "ways guard", timeout: 30 }] },
  ],
};

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlMultiline(value: string): string {
  return `"""\n${value.replaceAll('"""', '\\"\\"\\"')}\n"""`;
}

export function renderCodex(source: AdapterSource): RenderedFile[] {
  const files: RenderedFile[] = [];
  for (const command of source.commands) {
    files.push({ path: `${SKILLS_DIR}/ways-${command.name}/SKILL.md`, content: renderSkill(command, NAMES) });
  }
  for (const role of source.roles) {
    const lines = [
      `name = ${tomlString(`ways-${role.name}`)}`,
      `description = ${tomlString(role.description)}`,
      ...(role.access === "read" ? ['sandbox_mode = "read-only"'] : []),
      `developer_instructions = ${tomlMultiline(resolveWith(role.body, NAMES))}`,
    ];
    files.push({ path: `${CODEX_DIR}/agents/ways-${role.name}.toml`, content: `${lines.join("\n")}\n` });
  }
  files.push({ path: GUARD_PATH, content: resolveWith(source.guard, NAMES), mode: 0o755 });
  return files;
}

function isGuardGroup(entry: unknown, wanted: HookEntry): boolean {
  if (!isObject(entry) || entry.matcher !== wanted.matcher || !Array.isArray(entry.hooks)) return false;
  return entry.hooks.some((hook) => isObject(hook) && hook.command === GUARD_COMMAND);
}

export const codexAdapter: ProviderAdapter = {
  id: "codex",
  render: renderCodex,
  merge: (cwd) => mergeHookFile(cwd, HOOKS_PATH, GUARD_HOOKS, isGuardGroup),
  verify: (cwd) => verifyHookFile(cwd, HOOKS_PATH, "codex", GUARD_HOOKS, isGuardGroup),
};
