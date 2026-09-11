import { lstat, readdir, readFile } from "node:fs/promises";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { parse } from "yaml";
import { KNOWLEDGE_DIR } from "../domain/constants.js";
import { validateSources } from "../memory/validation.js";

export interface OkfDocument {
  id: string;
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  links: string[];
}

export interface OkfIssue {
  code: string;
  path: string;
  message: string;
}

const ACTOR = /^(?:human:[^\s]+|process:[^\s]+|[^\s/]+\/[^\s/]+)$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

async function files(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith(".md")) found.push(path);
    }
  }
  await walk(root);
  return found.sort();
}

export function parseOkfDocument(path: string, root: string, content: string): OkfDocument {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) throw new Error("Missing YAML frontmatter");
  const value: unknown = parse(match[1] ?? "");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Frontmatter must be a mapping");
  const relativePath = relative(root, path).replaceAll("\\", "/");
  const body = content.slice(match[0].length);
  const links = [...body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((item) => item[1] ?? "").filter(Boolean);
  return { id: relativePath.replace(/\.md$/, ""), path: relativePath, frontmatter: value as Record<string, unknown>, body, links };
}

function events(value: unknown): Array<Record<string, unknown>> {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  return typeof value === "object" ? [value as Record<string, unknown>] : [];
}

function validEvent(event: Record<string, unknown>): boolean {
  return typeof event.by === "string" && ACTOR.test(event.by) && typeof event.at === "string" && DATE_TIME.test(event.at);
}

async function targetExists(root: string, documentPath: string, target: string): Promise<boolean> {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) return true;
  const clean = target.split("#", 1)[0];
  if (!clean) return true;
  const path = clean.startsWith("/") ? join(root, clean.slice(1)) : resolve(dirname(join(root, documentPath)), clean);
  if (!normalize(path).startsWith(normalize(root))) return false;
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

export async function inspectOkf(cwd: string, options: { validateSources?: boolean } = {}): Promise<{ documents: OkfDocument[]; issues: OkfIssue[] }> {
  const root = join(cwd, KNOWLEDGE_DIR);
  const documents: OkfDocument[] = [];
  const issues: OkfIssue[] = [];
  let markdown: string[];
  try {
    markdown = await files(root);
  } catch {
    return { documents, issues: [{ code: "missing-okf", path: KNOWLEDGE_DIR, message: "Knowledge bundle is missing" }] };
  }

  for (const path of markdown) {
    const relativePath = relative(root, path).replaceAll("\\", "/");
    const name = relativePath.split("/").at(-1);
    const content = await readFile(path, "utf8");
    if (name === "index.md") {
      if (relativePath !== "index.md" && content.startsWith("---\n")) issues.push({ code: "okf-index-frontmatter", path: relativePath, message: "Only the root index may have frontmatter" });
      continue;
    }
    if (name === "log.md") {
      for (const heading of content.matchAll(/^##\s+(.+)$/gm)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(heading[1] ?? "")) issues.push({ code: "okf-log-date", path: relativePath, message: "Log dates must use YYYY-MM-DD" });
      }
      continue;
    }

    let document: OkfDocument;
    try {
      document = parseOkfDocument(path, root, content);
      documents.push(document);
    } catch (error) {
      issues.push({ code: "okf-frontmatter", path: relativePath, message: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const fm = document.frontmatter;
    if (typeof fm.type !== "string" || !fm.type.trim()) issues.push({ code: "okf-type", path: relativePath, message: "Concept requires a non-empty type" });
    if (fm.status !== undefined && !["draft", "stable", "deprecated"].includes(String(fm.status))) issues.push({ code: "okf-status", path: relativePath, message: "Status must be draft, stable, or deprecated" });
    if (fm.generated !== undefined && (!fm.generated || typeof fm.generated !== "object" || Array.isArray(fm.generated) || !validEvent(fm.generated as Record<string, unknown>))) {
      issues.push({ code: "okf-generated", path: relativePath, message: "generated requires valid by and at fields" });
    }
    const verified = events(fm.verified);
    if (fm.verified !== undefined && (verified.length === 0 || verified.some((event) => !validEvent(event)))) issues.push({ code: "okf-verified", path: relativePath, message: "verified events require valid actors and timestamps" });
    const status = fm.status === undefined ? "stable" : String(fm.status);
    if (status === "stable" && verified.length === 0) issues.push({ code: "unverified-stable", path: relativePath, message: "Stable concepts require verification" });
    if (typeof fm.stale_after === "string" && (!DATE_TIME.test(fm.stale_after) || Date.parse(fm.stale_after) <= Date.now()) && status === "stable") {
      issues.push({ code: "stale-concept", path: relativePath, message: "Stable concept is stale or has invalid stale_after" });
    }
    if (fm.sources !== undefined) {
      if (!Array.isArray(fm.sources) || fm.sources.some((source) => !source || typeof source !== "object" || typeof (source as Record<string, unknown>).resource !== "string")) {
        issues.push({ code: "okf-sources", path: relativePath, message: "Every source requires a resource" });
      }
    }
    for (const link of document.links) {
      if (!await targetExists(root, document.path, link)) issues.push({ code: "broken-okf-link", path: relativePath, message: `Missing link target: ${link}` });
    }
  }
  if (options.validateSources ?? true) {
    const active = documents.filter((document) => document.frontmatter.status !== "deprecated" && !document.path.startsWith("deprecated/"));
    issues.push(...await validateSources(cwd, active));
  }
  return { documents, issues };
}
