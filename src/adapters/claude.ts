import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { stableJson, writeAtomic } from "../fs/files.js";
import type { AdapterSource, ProviderAdapter, RenderedFile } from "./types.js";

export const CLAUDE_DIR = ".claude";
const STATUSLINE_PATH = `${CLAUDE_DIR}/ways-statusline.sh`;
const GUARD_PATH = `${CLAUDE_DIR}/ways-guard.sh`;
const SETTINGS_PATH = `${CLAUDE_DIR}/settings.json`;
const READ_TOOLS = "Read, Grep, Glob, Bash";

function frontmatter(entries: Array<[string, string | undefined]>): string {
  const lines = entries.filter((entry): entry is [string, string] => Boolean(entry[1])).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

export function renderClaude(source: AdapterSource): RenderedFile[] {
  const files: RenderedFile[] = [];
  for (const command of source.commands) {
    files.push({
      path: `${CLAUDE_DIR}/commands/ways-${command.name}.md`,
      content: `${frontmatter([["description", command.description], ["argument-hint", command.usage]])}\n${command.body}\n`,
    });
  }
  for (const role of source.roles) {
    const readOnly: Array<[string, string | undefined]> = role.access === "read" ? [["tools", READ_TOOLS], ["permissionMode", "plan"]] : [];
    files.push({
      path: `${CLAUDE_DIR}/agents/ways-${role.name}.md`,
      content: `${frontmatter([["name", `ways-${role.name}`], ["description", role.description], ...readOnly])}\n${role.body}\n`,
    });
  }
  files.push({ path: STATUSLINE_PATH, content: source.statusline, mode: 0o755 });
  files.push({ path: GUARD_PATH, content: source.guard, mode: 0o755 });
  return files;
}

type Settings = Record<string, unknown>;

interface HookGroup {
  matcher?: string;
  hooks: Array<{ type: string; command: string }>;
}

async function readSettings(cwd: string): Promise<Settings> {
  try {
    const value: unknown = JSON.parse(await readFile(join(cwd, SETTINGS_PATH), "utf8"));
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Settings;
    throw new Error(`${SETTINGS_PATH} must contain a JSON object`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

/** Adds the statusline and guard hook to Claude settings without touching other keys. */
export function mergeClaudeSettings(settings: Settings): Settings {
  const next: Settings = { ...settings };
  next.statusLine = { type: "command", command: STATUSLINE_PATH };
  const hooks = { ...((next.hooks as Record<string, unknown> | undefined) ?? {}) };
  const groups = Array.isArray(hooks.PreToolUse) ? [...(hooks.PreToolUse as HookGroup[])] : [];
  const present = groups.some((group) => group.hooks?.some((hook) => hook.command === GUARD_PATH));
  if (!present) groups.push({ matcher: "Bash", hooks: [{ type: "command", command: GUARD_PATH }] });
  hooks.PreToolUse = groups;
  next.hooks = hooks;
  return next;
}

async function mergeSettingsFile(cwd: string): Promise<string[]> {
  const merged = mergeClaudeSettings(await readSettings(cwd));
  await writeAtomic(join(cwd, SETTINGS_PATH), stableJson(merged));
  return [SETTINGS_PATH];
}

export const claudeAdapter: ProviderAdapter = {
  id: "claude",
  render: renderClaude,
  merge: mergeSettingsFile,
};
