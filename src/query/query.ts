import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { KNOWLEDGE_DIR } from "../domain/constants.js";

export interface QueryHit {
  path: string;
  score: number;
  preview: string;
}

async function markdownFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "index.md") results.push(path);
    }
  }
  try {
    await walk(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return results;
}

export async function queryKnowledge(cwd: string, query: string, limit = 10): Promise<QueryHit[]> {
  const terms = query.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(Boolean);
  if (terms.length === 0) return [];
  const root = join(cwd, KNOWLEDGE_DIR);
  const hits: QueryHit[] = [];

  for (const path of await markdownFiles(root)) {
    const content = await readFile(path, "utf8");
    const lower = content.toLowerCase();
    const score = terms.reduce((total, term) => total + lower.split(term).length - 1, 0);
    if (score > 0) {
      const body = content.replace(/^---[\s\S]*?---\s*/u, "").replace(/\s+/g, " ").trim();
      hits.push({ path: relative(cwd, path), score, preview: body.slice(0, 180) });
    }
  }

  return hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
}
