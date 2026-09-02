import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { queryKnowledge, queryKnowledgeResult } from "../src/query/query.js";

async function concept(cwd: string, path: string, frontmatter: string, body: string): Promise<void> {
  const target = join(cwd, ".ways/knowledge", path);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, `---\n${frontmatter}\n---\n\n${body}\n`);
}

describe("queryKnowledge", () => {
  it("uses a lazily-created search index without creating workflow state", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "ways-query-"));
    await concept(cwd, "faq/auth.md", "type: faq\nstatus: draft", "# Auth\nTokens use rotation.");
    const hits = await queryKnowledge(cwd, "token rotation");
    expect(hits[0]?.path).toContain("auth.md");
    expect(hits[0]?.score).toBe(2);
    expect(hits[0]?.labels).toEqual(["draft", "unverified"]);
    expect(JSON.parse(await readFile(join(cwd, ".ways/indexes/search.json"), "utf8")).terms.rotation).toEqual(["faq/auth"]);
  });

  it("excludes deprecated material and labels auxiliary material", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "ways-query-"));
    await concept(cwd, "deprecated/old-auth.md", "type: component\nstatus: deprecated", "Shared needle.");
    await concept(cwd, "roadmap/new-auth.md", "type: roadmap\nstatus: draft", "Shared needle.");
    await concept(cwd, "debt/auth-cleanup.md", "type: debt\nstatus: draft", "Shared needle.");
    const hits = await queryKnowledge(cwd, "needle");
    expect(hits.map((hit) => hit.path)).toEqual([".ways/knowledge/debt/auth-cleanup.md", ".ways/knowledge/roadmap/new-auth.md"]);
    expect(hits[0]?.labels).toEqual(["draft", "unverified", "debt"]);
    expect(hits[1]?.labels).toEqual(["draft", "unverified", "roadmap"]);
  });

  it("exposes freshness warnings from the code-tree watermark owner", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "ways-query-"));
    await concept(cwd, "faq/auth.md", "type: faq\nstatus: draft", "Token rotation.");
    const freshness = vi.fn(async () => ["memory may be stale for src/auth/**"]);
    const result = await queryKnowledgeResult(cwd, "token", { freshness });
    expect(freshness).toHaveBeenCalledWith(cwd);
    expect(result.warnings).toEqual(["memory may be stale for src/auth/**"]);
  });
});
