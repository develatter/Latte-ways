import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { indexesMatch, writeIndexes } from "../src/knowledge/indexes.js";

it("builds deterministic catalog, graph, and search indexes", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "ways-index-"));
  const dir = join(cwd, ".ways/knowledge/components");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "api.md"), "---\ntype: component\ntitle: API\nstatus: draft\ngenerated: { by: explorer/v1, at: 2026-01-01T00:00:00Z }\n---\n\nUses [auth](auth.md).\n");
  await writeFile(join(dir, "auth.md"), "---\ntype: component\ntitle: Auth\nstatus: draft\ngenerated: { by: explorer/v1, at: 2026-01-01T00:00:00Z }\n---\n\nToken rotation.\n");
  await writeIndexes(cwd);
  expect(await indexesMatch(cwd)).toBe(true);
  const graph = JSON.parse(await readFile(join(cwd, ".ways/indexes/graph.json"), "utf8"));
  expect(graph.edges).toEqual([{ from: "components/api", to: "components/auth" }]);
});
