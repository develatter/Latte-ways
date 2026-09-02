import { isObject, mergeHookFile, verifyHookFile, type HookEntry } from "./hook-file.js";
import { renderSkill, resolveWith, SLASH_NAMES, yamlFrontmatter } from "./render.js";
import type { AdapterSource, ProviderAdapter, RenderedFile } from "./types.js";

/**
 * Cursor (editor and cursor-agent CLI). Per cursor.com/docs (2026-09): commands
 * become skills in `.cursor/skills/<name>/SKILL.md` with `disable-model-invocation`
 * so they only run as `/name`; roles become `.cursor/agents/<name>.md` with
 * `readonly: true` for read roles; the guard runs from `.cursor/hooks.json`
 * (version 1) on `beforeShellExecution` and `preToolUse` for `Write`, with
 * `failClosed`. Exit 2 denies. Cursor reads `AGENTS.md` at the project root.
 */
export const CURSOR_DIR = ".cursor";
const GUARD_PATH = `${CURSOR_DIR}/ways-guard.sh`;
const HOOKS_PATH = `${CURSOR_DIR}/hooks.json`;
const GUARD_COMMAND = `./${GUARD_PATH}`;

const GUARD_HOOKS: Record<string, HookEntry[]> = {
  beforeShellExecution: [{ command: GUARD_COMMAND, timeout: 30, failClosed: true }],
  preToolUse: [{ command: GUARD_COMMAND, matcher: "Write", timeout: 30, failClosed: true }],
};

export function renderCursor(source: AdapterSource): RenderedFile[] {
  const files: RenderedFile[] = [];
  for (const command of source.commands) {
    files.push({ path: `${CURSOR_DIR}/skills/ways-${command.name}/SKILL.md`, content: renderSkill(command, SLASH_NAMES, [["disable-model-invocation", true]]) });
  }
  for (const role of source.roles) {
    const front = yamlFrontmatter([["name", `ways-${role.name}`], ["description", role.description], ["model", "inherit"], ["readonly", role.access === "read" ? true : undefined]]);
    files.push({ path: `${CURSOR_DIR}/agents/ways-${role.name}.md`, content: `${front}\n${resolveWith(role.body, SLASH_NAMES)}\n` });
  }
  files.push({ path: GUARD_PATH, content: resolveWith(source.guard, SLASH_NAMES), mode: 0o755 });
  return files;
}

function isGuardEntry(entry: unknown, wanted: HookEntry): boolean {
  return isObject(entry) && entry.command === GUARD_COMMAND && entry.matcher === wanted.matcher;
}

export const cursorAdapter: ProviderAdapter = {
  id: "cursor",
  render: renderCursor,
  merge: (cwd) => mergeHookFile(cwd, HOOKS_PATH, GUARD_HOOKS, isGuardEntry, { version: 1 }),
  verify: (cwd) => verifyHookFile(cwd, HOOKS_PATH, "cursor", GUARD_HOOKS, isGuardEntry),
};
