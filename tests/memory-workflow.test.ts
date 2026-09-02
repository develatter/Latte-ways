import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GitRepository } from "../src/git/git.js";
import { canonicalCodeTreeDigest } from "../src/memory/digest.js";
import {
  commitMemory,
  completeDiscovery,
  DISCOVERY_PATH,
  discoveryReviewDigest,
  MEMORY_STATE_PATH,
  memoryCommitReviewDigest,
  requestDiscovery,
  SEMANTIC_REVIEW_DIR,
} from "../src/memory/workflow.js";
import { startQuick } from "../src/work/quick.js";

async function repository(): Promise<{ cwd: string; git: GitRepository }> {
  const cwd = await mkdtemp(join(tmpdir(), "ways-memory-workflow-"));
  const git = new GitRepository(cwd);
  await git.run(["init", "-q"]);
  await git.run(["config", "user.name", "Ways Test"]);
  await git.run(["config", "user.email", "ways@example.test"]);
  await mkdir(join(cwd, "src"), { recursive: true });
  await mkdir(join(cwd, ".ways/knowledge/coverage"), { recursive: true });
  await writeFile(join(cwd, "src/main.ts"), "export const value = 1;\n");
  await writeFile(join(cwd, ".ways/config.json"), JSON.stringify({
    schemaVersion: 1,
    harnessVersion: "test",
    testCommand: ["true"],
    memory: {
      releaseBranch: "main",
      reconciliationBranchPattern: "reconcile/*",
      relevantPaths: ["src/**"],
      excludedPaths: [],
    },
  }));
  await writeFile(join(cwd, ".ways/knowledge/index.md"), "# Knowledge\n");
  await writeFile(join(cwd, ".ways/knowledge/coverage/runtime.json"), JSON.stringify({
    schemaVersion: 1,
    id: "runtime",
    globs: ["src/**"],
    classification: "implementation-detail",
    concepts: [],
  }));
  await git.run(["add", "."]);
  await git.run(["commit", "-q", "-m", "initial"]);
  return { cwd, git };
}

async function establishBaseline(cwd: string, git: GitRepository): Promise<void> {
  const revision = await git.head();
  const digest = await canonicalCodeTreeDigest(git, revision, {
    releaseBranch: "main",
    reconciliationBranchPattern: "reconcile/*",
    relevantPaths: ["src/**"],
    excludedPaths: [],
  });
  await writeFile(join(cwd, MEMORY_STATE_PATH), JSON.stringify({
    schemaVersion: 1,
    generation: 0,
    watermark: { revision, digest, reviewDigest: "0".repeat(64) },
  }));
  await git.run(["add", MEMORY_STATE_PATH]);
  await git.run(["commit", "-q", "-m", "memory baseline"]);
}

async function passingReview(cwd: string, workId: string, digest: string): Promise<string> {
  const path = join(cwd, "review.json");
  await writeFile(path, JSON.stringify({ schemaVersion: 1, workId, reviewer: "independent/reviewer", digest, verdict: "pass", findings: [] }));
  return path;
}

describe("memory discovery", () => {
  it("requires a digest-bound review, supports greenfield memory, and only rediscovers explicitly", async () => {
    const { cwd } = await repository();
    const pending = await requestDiscovery(cwd);
    expect(pending.kind).toBe("bootstrap");
    expect((await requestDiscovery(cwd)).requestedAt).toBe(pending.requestedAt);

    const digest = await discoveryReviewDigest(cwd);
    const review = await passingReview(cwd, "memory-discovery", digest);
    await writeFile(join(cwd, ".ways/knowledge/index.md"), "# Changed after review\n");
    await expect(completeDiscovery(cwd, review)).rejects.toThrow("stale");
    await writeFile(join(cwd, ".ways/knowledge/index.md"), "# Knowledge\n");

    const state = await completeDiscovery(cwd, review);
    expect(state.watermark.reviewDigest).toBe(digest);
    await expect(readFile(join(cwd, DISCOVERY_PATH), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(join(cwd, MEMORY_STATE_PATH), "utf8"))).toEqual(state);
    await expect(requestDiscovery(cwd)).rejects.toThrow("explicitly requested");
    expect((await requestDiscovery(cwd, true)).kind).toBe("rediscovery");
  });
});

describe("incremental memory commit", () => {
  it("creates a separate traced commit linked to its implementation range and independent review", async () => {
    const { cwd, git } = await repository();
    await establishBaseline(cwd, git);
    await startQuick(cwd, "semantic-change");
    const from = await git.head();
    await writeFile(join(cwd, "src/main.ts"), "export const value = 2;\n");
    await git.commit(["src/main.ts"], "feat: change runtime", { work: "semantic-change" });
    const to = await git.head();

    await mkdir(join(cwd, ".ways/knowledge/components"), { recursive: true });
    await writeFile(join(cwd, ".ways/knowledge/components/runtime.md"), `---\ntype: component\nstatus: stable\nverified:\n  by: process:test\n  at: 2026-01-01T00:00:00Z\nsources:\n  - resource: /src/main.ts\n    revision: ${to}\n---\n# Runtime\nThe runtime exports the current value.\n`);
    await writeFile(join(cwd, ".ways/knowledge/coverage/runtime.json"), JSON.stringify({
      schemaVersion: 1,
      id: "runtime",
      globs: ["src/**"],
      classification: "concept-backed",
      concepts: ["components/runtime"],
    }));

    const range = `${from}..${to}`;
    const digest = await memoryCommitReviewDigest(cwd, range);
    const review = await passingReview(cwd, "semantic-change", digest);
    const conceptPath = join(cwd, ".ways/knowledge/components/runtime.md");
    const reviewedConcept = await readFile(conceptPath, "utf8");
    await writeFile(conceptPath, `${reviewedConcept}\nChanged after review.\n`);
    await expect(commitMemory(cwd, range, review, "docs(memory): describe runtime")).rejects.toThrow("stale");
    await writeFile(conceptPath, reviewedConcept);
    const commit = await commitMemory(cwd, range, review, "docs(memory): describe runtime");
    const info = await git.commitInfo(commit);
    expect(info.trailers.work).toBe("semantic-change");
    expect(info.trailers.implementation).toBe(range);
    expect(info.trailers.memoryReviewDigest).toBe(digest);
    expect(await git.changedPathsBetween(to, commit)).toEqual([
      ".ways/knowledge/components/runtime.md",
      ".ways/knowledge/coverage/runtime.json",
      `${SEMANTIC_REVIEW_DIR}/${digest}.json`,
    ]);
  });

  it("rejects uncommitted implementation and stale semantic reviews", async () => {
    const { cwd, git } = await repository();
    await establishBaseline(cwd, git);
    await startQuick(cwd, "semantic-change");
    const from = await git.head();
    await writeFile(join(cwd, "src/main.ts"), "export const value = 2;\n");
    await expect(memoryCommitReviewDigest(cwd, `${from}..HEAD`)).rejects.toThrow("non-empty ancestry");
  });
});
