import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectOkf } from "../src/knowledge/okf.js";

async function bundle(content: string): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "ways-okf-"));
  const dir = join(cwd, ".ways/knowledge/faq");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "item.md"), content);
  return cwd;
}

describe("OKF", () => {
  it("accepts a verified stable concept", async () => {
    const cwd = await bundle("---\ntype: faq\nstatus: stable\nverified: { by: human:owner, at: 2026-01-01T00:00:00Z }\n---\n\n# Answer\n");
    expect((await inspectOkf(cwd)).issues).toEqual([]);
  });

  it("rejects unverified stable knowledge", async () => {
    const cwd = await bundle("---\ntype: faq\n---\n\n# Answer\n");
    expect((await inspectOkf(cwd)).issues.map((issue) => issue.code)).toContain("unverified-stable");
  });

  it("allows agent-authored drafts with provenance", async () => {
    const cwd = await bundle("---\ntype: faq\nstatus: draft\ngenerated: { by: explorer/v1, at: 2026-01-01T00:00:00Z }\nsources:\n  - resource: /faq/item.md\n---\n\n# Answer\n");
    expect((await inspectOkf(cwd)).issues).toEqual([]);
  });
});
