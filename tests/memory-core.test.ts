import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MemoryConfig } from "../src/domain/types.js";
import { validationDetails, validateCoverage, validateMemoryState, validateReconciliation } from "../src/domain/validation.js";
import { GitRepository } from "../src/git/git.js";
import { inspectOkf } from "../src/knowledge/okf.js";
import { canonicalCodeTreeDigest } from "../src/memory/digest.js";
import { inspectCoverage, validateWatermark } from "../src/memory/validation.js";

const config: MemoryConfig = {
  releaseBranch: "main",
  reconciliationBranchPattern: "reconcile/*",
  relevantPaths: ["src/**"],
  excludedPaths: [],
};

async function repository(): Promise<{ cwd: string; git: GitRepository }> {
  const cwd = await mkdtemp(join(tmpdir(), "ways-memory-core-"));
  const git = new GitRepository(cwd);
  await git.run(["init", "-q"]);
  await git.run(["config", "user.name", "Ways Test"]);
  await git.run(["config", "user.email", "ways@example.test"]);
  await mkdir(join(cwd, "src"), { recursive: true });
  await writeFile(join(cwd, "src/main.ts"), "export const value = 1;\n");
  await git.run(["add", "."]);
  await git.run(["commit", "-q", "-m", "initial"]);
  return { cwd, git };
}

describe("memory schemas", () => {
  it("validates coverage, watermark and reconciliation records", () => {
    expect(validateCoverage({ schemaVersion: 1, id: "runtime", globs: ["src/**"], classification: "concept-backed", concepts: ["components/runtime"] })).toBe(true);
    expect(validateCoverage({ schemaVersion: 1, id: "runtime", globs: ["src/**"], classification: "concept-backed", concepts: [] })).toBe(false);
    expect(validateMemoryState({ schemaVersion: 1, generation: 0, watermark: { revision: "a".repeat(40), digest: "b".repeat(64), reviewDigest: "c".repeat(64) } })).toBe(true);
    expect(validateReconciliation({ schemaVersion: 1, generation: 1, base: "a".repeat(40), candidate: "b".repeat(40), target: "c".repeat(40), codeTreeDigest: "d".repeat(64), reviewDigest: "e".repeat(64), dispositions: [] })).toBe(true);
    expect(validationDetails("coverage", { schemaVersion: 1 }).valid).toBe(false);
  });
});

describe("canonical relevant-code digest", () => {
  it("depends on normalized tree content and mode, not commit identity or memory", async () => {
    const { cwd, git } = await repository();
    const first = await canonicalCodeTreeDigest(git, "HEAD", config);
    await git.run(["commit", "--allow-empty", "-q", "-m", "new identity"]);
    expect(await canonicalCodeTreeDigest(git, "HEAD", config)).toBe(first);

    await mkdir(join(cwd, ".ways/knowledge"), { recursive: true });
    await writeFile(join(cwd, ".ways/knowledge/note.md"), "memory only\n");
    await git.run(["add", "."]);
    await git.run(["commit", "-q", "-m", "memory"]);
    expect(await canonicalCodeTreeDigest(git, "HEAD", config)).toBe(first);

    await chmod(join(cwd, "src/main.ts"), 0o755);
    await git.run(["add", "src/main.ts"]);
    await git.run(["commit", "-q", "-m", "mode"]);
    expect(await canonicalCodeTreeDigest(git, "HEAD", config)).not.toBe(first);
  });

  it("validates a watermark against its exact revision", async () => {
    const { cwd, git } = await repository();
    const revision = await git.head();
    const digest = await canonicalCodeTreeDigest(git, revision, config);
    expect(await validateWatermark(cwd, { schemaVersion: 1, generation: 0, watermark: { revision, digest, reviewDigest: "a".repeat(64) } }, config)).toEqual([]);
    expect((await validateWatermark(cwd, { schemaVersion: 1, generation: 0, watermark: { revision, digest: "0".repeat(64), reviewDigest: "a".repeat(64) } }, config)).map((issue) => issue.code)).toContain("stale-watermark");
  });
});

describe("source and coverage validation", () => {
  it("fails missing active sources but ignores deprecated history sources", async () => {
    const { cwd, git } = await repository();
    await mkdir(join(cwd, ".ways/knowledge/components"), { recursive: true });
    await writeFile(join(cwd, ".ways/knowledge/components/active.md"), "---\ntype: component\nstatus: draft\nsources:\n  - resource: /src/missing.ts\n---\n");
    await writeFile(join(cwd, ".ways/knowledge/components/old.md"), "---\ntype: component\nstatus: deprecated\nsources:\n  - resource: /src/removed.ts\n---\n");
    await git.run(["add", "."]);
    await git.run(["commit", "-q", "-m", "knowledge"]);
    const issues = (await inspectOkf(cwd)).issues;
    expect(issues.map((issue) => issue.code)).toContain("missing-source");
    expect(issues.filter((issue) => issue.path.includes("old.md"))).toEqual([]);
  });

  it("requires every relevant path to have exactly one valid coverage area", async () => {
    const { cwd, git } = await repository();
    await mkdir(join(cwd, ".ways/knowledge/components"), { recursive: true });
    await mkdir(join(cwd, ".ways/knowledge/coverage"), { recursive: true });
    await writeFile(join(cwd, ".ways/knowledge/components/runtime.md"), "---\ntype: component\nstatus: draft\n---\n# Runtime\n");
    await writeFile(join(cwd, ".ways/knowledge/coverage/runtime.json"), JSON.stringify({ schemaVersion: 1, id: "runtime", globs: ["src/**"], classification: "concept-backed", concepts: ["components/runtime"] }));
    await git.run(["add", "."]);
    await git.run(["commit", "-q", "-m", "coverage"]);
    expect((await inspectCoverage(cwd, config)).issues).toEqual([]);

    await writeFile(join(cwd, ".ways/knowledge/coverage/duplicate.json"), JSON.stringify({ schemaVersion: 1, id: "duplicate", globs: ["src/main.ts"], classification: "implementation-detail", concepts: [] }));
    expect((await inspectCoverage(cwd, config)).issues.map((issue) => issue.code)).toContain("overlapping-coverage");
  });
});
