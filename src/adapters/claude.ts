import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { stableJson, writeAtomic } from "../fs/files.js";
import type { AdapterIssue, AdapterSource, MergeResult, ProviderAdapter, RenderedFile } from "./types.js";

export const CLAUDE_DIR = ".claude";
const STATUSLINE_PATH = `${CLAUDE_DIR}/ways-statusline.sh`;
const GUARD_PATH = `${CLAUDE_DIR}/ways-guard.sh`;
const GUARD_COMMAND = `"$CLAUDE_PROJECT_DIR"/${GUARD_PATH}`;
const SETTINGS_PATH = `${CLAUDE_DIR}/settings.json`;
const READ_TOOLS = "Read, Grep, Glob, Bash";

function frontmatter(entries: Array<[string, string | undefined]>): string {
  const lines = entries.filter((entry): entry is [string, string] => Boolean(entry[1])).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

/** Resolves neutral `{{command:x}}` and `{{role:x}}` placeholders into Claude names. */
export function resolveNames(text: string): string {
  return text.replace(/\{\{command:([a-z-]+)\}\}/g, "/ways-$1").replace(/\{\{role:([a-z-]+)\}\}/g, "ways-$1");
}

export function renderClaude(source: AdapterSource): RenderedFile[] {
  const files: RenderedFile[] = [];
  for (const command of source.commands) {
    files.push({
      path: `${CLAUDE_DIR}/commands/ways-${command.name}.md`,
      content: `${frontmatter([["description", command.description], ["argument-hint", command.usage]])}\n${resolveNames(command.body)}\n`,
    });
  }
  for (const role of source.roles) {
    const readOnly: Array<[string, string | undefined]> = role.access === "read" ? [["tools", READ_TOOLS], ["permissionMode", "plan"]] : [];
    files.push({
      path: `${CLAUDE_DIR}/agents/ways-${role.name}.md`,
      content: `${frontmatter([["name", `ways-${role.name}`], ["description", role.description], ...readOnly])}\n${resolveNames(role.body)}\n`,
    });
  }
  files.push({ path: STATUSLINE_PATH, content: resolveNames(source.statusline), mode: 0o755 });
  files.push({ path: GUARD_PATH, content: resolveNames(source.guard), mode: 0o755 });
  return files;
}

type Settings = Record<string, unknown>;

interface HookGroup {
  matcher?: string;
  hooks?: Array<{ type?: string; command?: string }>;
}

function isObject(value: unknown): value is Settings {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readSettings(cwd: string): Promise<Settings> {
  try {
    const value: unknown = JSON.parse(await readFile(join(cwd, SETTINGS_PATH), "utf8"));
    if (isObject(value)) return value;
    throw new Error(`${SETTINGS_PATH} must contain a JSON object`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

function guardGroups(settings: Settings): HookGroup[] {
  const hooks = settings.hooks;
  if (!isObject(hooks) || !Array.isArray(hooks.PreToolUse)) return [];
  return hooks.PreToolUse as HookGroup[];
}

export function hasGuard(settings: Settings): boolean {
  return guardGroups(settings).some((group) => group.hooks?.some((hook) => hook.command === GUARD_COMMAND));
}

/**
 * Adds the guard hook and, unless the user configured their own, the statusline.
 * Every other key is preserved verbatim.
 */
export function mergeClaudeSettings(settings: Settings): { settings: Settings; notes: string[] } {
  const next: Settings = { ...settings };
  const notes: string[] = [];
  const statusLine = next.statusLine;
  if (isObject(statusLine) && typeof statusLine.command === "string" && statusLine.command !== STATUSLINE_PATH) {
    notes.push(`kept existing statusLine (${statusLine.command}); ${STATUSLINE_PATH} is available`);
  } else {
    next.statusLine = { type: "command", command: STATUSLINE_PATH };
  }
  const hooks: Settings = isObject(next.hooks) ? { ...next.hooks } : {};
  const groups = Array.isArray(hooks.PreToolUse) ? [...(hooks.PreToolUse as HookGroup[])] : [];
  if (!hasGuard(next)) groups.push({ matcher: "Bash", hooks: [{ type: "command", command: GUARD_COMMAND }] });
  hooks.PreToolUse = groups;
  next.hooks = hooks;
  return { settings: next, notes };
}

async function mergeSettingsFile(cwd: string): Promise<MergeResult> {
  const { settings, notes } = mergeClaudeSettings(await readSettings(cwd));
  await writeAtomic(join(cwd, SETTINGS_PATH), stableJson(settings));
  return { files: [SETTINGS_PATH], notes };
}

async function verifySettings(cwd: string): Promise<AdapterIssue[]> {
  let settings: Settings;
  try {
    settings = await readSettings(cwd);
  } catch {
    return [{ code: "adapter-settings-invalid", path: SETTINGS_PATH, message: "Claude settings are unreadable" }];
  }
  const issues: AdapterIssue[] = [];
  if (!hasGuard(settings)) issues.push({ code: "adapter-guard-missing", path: SETTINGS_PATH, message: "PreToolUse guard hook is not configured; run ways adapter install claude" });
  if (!isObject(settings.statusLine) || typeof settings.statusLine.command !== "string") {
    issues.push({ code: "adapter-statusline-missing", path: SETTINGS_PATH, message: "statusLine is not configured; run ways adapter install claude" });
  }
  return issues;
}

export const claudeAdapter: ProviderAdapter = {
  id: "claude",
  render: renderClaude,
  merge: mergeSettingsFile,
  verify: verifySettings,
};
