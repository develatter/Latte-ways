import { readFile } from "node:fs/promises";
import { join, normalize, posix } from "node:path";
import { INDEX_DIR } from "../domain/constants.js";
import { stableJson, writeAtomic } from "../fs/files.js";
import { inspectOkf, type OkfDocument } from "./okf.js";

interface CatalogEntry {
  id: string;
  path: string;
  type: string;
  title: string;
  description: string;
  status: string;
  trust: "unverified" | "machine-confirmed" | "human-reviewed";
  tags: string[];
}

export interface KnowledgeIndexes {
  catalog: { schemaVersion: 1; documents: CatalogEntry[] };
  graph: { schemaVersion: 1; edges: Array<{ from: string; to: string }> };
  search: { schemaVersion: 1; terms: Record<string, string[]> };
}

function verificationEvents(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  return value && typeof value === "object" ? [value as Record<string, unknown>] : [];
}

function trust(document: OkfDocument): CatalogEntry["trust"] {
  const actors = verificationEvents(document.frontmatter.verified).map((event) => String(event.by ?? ""));
  if (actors.some((actor) => actor.startsWith("human:"))) return "human-reviewed";
  return actors.length > 0 ? "machine-confirmed" : "unverified";
}

function targetId(document: OkfDocument, target: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) return undefined;
  const clean = target.split("#", 1)[0];
  if (!clean?.endsWith(".md")) return undefined;
  const path = clean.startsWith("/") ? clean.slice(1) : posix.join(posix.dirname(document.path), clean);
  return normalize(path).replaceAll("\\", "/").replace(/\.md$/, "");
}

function terms(document: OkfDocument): string[] {
  const text = [document.id, document.frontmatter.title, document.frontmatter.description, document.frontmatter.tags, document.body].flat().join(" ").toLowerCase();
  return [...new Set(text.split(/[^\p{L}\p{N}_-]+/u).filter((term) => term.length > 1))].sort();
}

export async function buildIndexes(cwd: string): Promise<KnowledgeIndexes> {
  const { documents, issues } = await inspectOkf(cwd);
  if (issues.length > 0) throw new Error(`Cannot index invalid OKF: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
  const catalog = documents.map((document): CatalogEntry => ({
    id: document.id,
    path: document.path,
    type: String(document.frontmatter.type),
    title: typeof document.frontmatter.title === "string" ? document.frontmatter.title : document.id.split("/").at(-1) ?? document.id,
    description: typeof document.frontmatter.description === "string" ? document.frontmatter.description : "",
    status: typeof document.frontmatter.status === "string" ? document.frontmatter.status : "stable",
    trust: trust(document),
    tags: Array.isArray(document.frontmatter.tags) ? document.frontmatter.tags.map(String).sort() : [],
  })).sort((a, b) => a.id.localeCompare(b.id));

  const edges = documents.flatMap((document) => document.links.map((link) => targetId(document, link)).filter((id): id is string => Boolean(id)).map((to) => ({ from: document.id, to })))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  const inverted = new Map<string, string[]>();
  for (const document of documents) {
    for (const term of terms(document)) inverted.set(term, [...(inverted.get(term) ?? []), document.id]);
  }
  const searchTerms = Object.fromEntries([...inverted.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([term, ids]) => [term, ids.sort()]));
  return { catalog: { schemaVersion: 1, documents: catalog }, graph: { schemaVersion: 1, edges }, search: { schemaVersion: 1, terms: searchTerms } };
}

export async function writeIndexes(cwd: string): Promise<KnowledgeIndexes> {
  const indexes = await buildIndexes(cwd);
  await writeAtomic(join(cwd, INDEX_DIR, "catalog.json"), stableJson(indexes.catalog));
  await writeAtomic(join(cwd, INDEX_DIR, "graph.json"), stableJson(indexes.graph));
  await writeAtomic(join(cwd, INDEX_DIR, "search.json"), stableJson(indexes.search));
  return indexes;
}

export async function indexesMatch(cwd: string): Promise<boolean> {
  const expected = await buildIndexes(cwd);
  try {
    const names: Array<keyof KnowledgeIndexes> = ["catalog", "graph", "search"];
    for (const name of names) {
      const actual = await readFile(join(cwd, INDEX_DIR, `${name}.json`), "utf8");
      if (actual !== stableJson(expected[name])) return false;
    }
    return true;
  } catch {
    return false;
  }
}
