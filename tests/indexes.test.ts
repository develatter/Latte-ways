import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { indexesMatch, loadIndexes, writeIndexes } from "../src/knowledge/indexes.js";

async function repository(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "ways-index-"));
  const dir = join(cwd, ".ways/knowledge/components");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "api.md"), "---\ntype: component\ntitle: API\nstatus: draft\ngenerated: { by: explorer/v1, at: 2026-01-01T00:00:00Z }\n---\n\nUses [auth](auth.md).\n");
  await writeFile(join(dir, "auth.md"), "---\ntype: component\ntitle: Auth\nstatus: draft\ngenerated: { by: explorer/v1, at: 2026-01-01T00:00:00Z }\n---\n\nToken rotation.\n");
  return cwd;
}

async function cache(cwd: string): Promise<string[]> {
  return Promise.all(["catalog", "graph", "search"].map((name) => readFile(join(cwd, `.ways/indexes/${name}.json`), "utf8")));
}

describe("knowledge index cache", () => {
  it("builds deterministic catalog, graph, and search indexes", async () => {
    const cwd = await repository();
    await writeIndexes(cwd);
    const first = await cache(cwd);
    await writeIndexes(cwd);
    expect(await cache(cwd)).toEqual(first);
    expect(await indexesMatch(cwd)).toBe(true);
    const graph = JSON.parse(first[1]!);
    expect(graph.edges).toEqual([{ from: "components/api", to: "components/auth" }]);
  });

  it("lazily creates missing caches and repairs stale caches", async () => {
    const cwd = await repository();
    await loadIndexes(cwd);
    expect(await indexesMatch(cwd)).toBe(true);
    await writeFile(join(cwd, ".ways/indexes/search.json"), "{}\n");
    await loadIndexes(cwd);
    expect(await indexesMatch(cwd)).toBe(true);
  });

  it("returns fresh in-memory indexes when the cache cannot be written", async () => {
    const cwd = await repository();
    await mkdir(join(cwd, ".ways"), { recursive: true });
    await rm(join(cwd, ".ways/indexes"), { recursive: true, force: true });
    await writeFile(join(cwd, ".ways/indexes"), "not a directory");
    const indexes = await loadIndexes(cwd);
    expect(indexes.catalog.documents.map((document) => document.id)).toEqual(["components/api", "components/auth"]);
  });
});
