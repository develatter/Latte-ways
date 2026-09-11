import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { MemoryConfig } from "../src/domain/types.js";
import { GitRepository } from "../src/git/git.js";
import { canonicalCodeTreeDigest } from "../src/memory/digest.js";
import { inspectMemoryFreshness } from "../src/memory/freshness.js";

it("reports affected coverage for content drift but ignores commit-only transport", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "ways-freshness-"));
  const git = new GitRepository(cwd);
  const config: MemoryConfig = { releaseBranch: "main", reconciliationBranchPattern: "reconcile/*", relevantPaths: ["src/**"], excludedPaths: [] };
  await git.run(["init", "-q"]);
  await git.run(["config", "user.name", "Ways Test"]);
  await git.run(["config", "user.email", "ways@example.test"]);
  await mkdir(join(cwd, "src"), { recursive: true });
  await mkdir(join(cwd, ".ways/knowledge/coverage"), { recursive: true });
  await writeFile(join(cwd, "src/auth.ts"), "export const auth = true;\n");
  await writeFile(join(cwd, ".ways/knowledge/coverage/auth.json"), JSON.stringify({ schemaVersion: 1, id: "auth", globs: ["src/auth.ts"], classification: "implementation-detail", concepts: [] }));
  await git.run(["add", "."]);
  await git.run(["commit", "-q", "-m", "baseline"]);
  const revision = await git.head();
  const state = { schemaVersion: 1 as const, generation: 1, watermark: { revision, digest: await canonicalCodeTreeDigest(git, revision, config), reviewDigest: "a".repeat(64) } };

  await git.run(["commit", "--allow-empty", "-q", "-m", "transport"]);
  expect((await inspectMemoryFreshness(cwd, config, state)).current).toBe(true);

  await writeFile(join(cwd, "src/auth.ts"), "export const auth = false;\n");
  await git.run(["add", "."]);
  await git.run(["commit", "-q", "-m", "change auth"]);
  const freshness = await inspectMemoryFreshness(cwd, config, state);
  expect(freshness.current).toBe(false);
  expect(freshness.changedPaths).toEqual(["src/auth.ts"]);
  expect(freshness.affectedAreas).toEqual(["auth"]);
  expect(freshness.warnings[0]).toContain("generation 1");
});
