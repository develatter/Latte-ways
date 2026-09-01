import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { queryKnowledge } from "../src/query/query.js";

describe("queryKnowledge", () => {
  it("searches concepts without creating state", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "ways-query-"));
    const faq = join(cwd, ".ways/knowledge/faq");
    await mkdir(faq, { recursive: true });
    await writeFile(join(faq, "auth.md"), "---\ntype: faq\n---\n\n# Auth\nTokens use rotation.\n");
    const hits = await queryKnowledge(cwd, "token rotation");
    expect(hits[0]?.path).toContain("auth.md");
    expect(hits[0]?.score).toBe(2);
  });
});
