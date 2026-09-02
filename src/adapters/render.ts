import type { AdapterSource } from "./types.js";

export interface NameStyle {
  /** How the provider invokes a harness command, e.g. `/ways-quick` or `$ways-quick`. */
  command(name: string): string;
  /** How the provider names a harness role, e.g. `ways-reviewer`. */
  role(name: string): string;
}

export const SLASH_NAMES: NameStyle = { command: (name) => `/ways-${name}`, role: (name) => `ways-${name}` };

/** Resolves neutral `{{command:x}}` and `{{role:x}}` placeholders into provider names. */
export function resolveWith(text: string, style: NameStyle): string {
  return text.replace(/\{\{command:([a-z-]+)\}\}/g, (_, name: string) => style.command(name)).replace(/\{\{role:([a-z-]+)\}\}/g, (_, name: string) => style.role(name));
}

/** Providers whose skills carry no argument placeholder get the arguments spelled out. */
export function spellArguments(text: string): string {
  return text.replaceAll("$ARGUMENTS", "the arguments the human gave with this skill");
}

export function yamlFrontmatter(entries: Array<[string, string | boolean | undefined]>): string {
  const lines = entries.filter((entry): entry is [string, string | boolean] => entry[1] !== undefined && entry[1] !== "").map(([key, value]) => `${key}: ${typeof value === "string" ? quoteIfNeeded(value) : String(value)}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

function quoteIfNeeded(value: string): string {
  return /[:#"'\n]|^\s|\s$/.test(value) ? JSON.stringify(value) : value;
}

/** Agent Skills standard (agentskills.io) SKILL.md, used by Codex and Cursor for slash-style commands. */
export function renderSkill(source: AdapterSource["commands"][number], style: NameStyle, extra: Array<[string, string | boolean | undefined]> = []): string {
  const usage = source.usage ? `\nArguments: \`${source.usage}\`\n` : "";
  return `${yamlFrontmatter([["name", `ways-${source.name}`], ["description", source.description], ...extra])}${usage}\n${spellArguments(resolveWith(source.body, style))}\n`;
}
