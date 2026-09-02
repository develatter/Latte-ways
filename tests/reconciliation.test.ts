import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { MemoryConfig } from "../src/domain/types.js";
import { GitRepository } from "../src/git/git.js";
import { canonicalCodeTreeDigest } from "../src/memory/digest.js";
import type { MemoryState, ReconciliationEvidence } from "../src/memory/model.js";
import {
  inspectReconciliationCandidate,
  reconciliationPayloadDigest,
  reconciliationReviewDigest,
  validateBackSyncMerge,
  validatePublicationMerge,
  validateReconciliationEvidence,
} from "../src/memory/reconciliation.js";

const config: MemoryConfig = {
  releaseBranch: "main",
  integrationBranch: "development",
  reconciliationBranchPattern: "reconcile/*",
  relevantPaths: ["src/**"],
  excludedPaths: [],
};

let cwd: string;
let git: GitRepository;
let initial: string;
let snapshot: string;
let reconcile: string;
let state: MemoryState;

async function commit(path: string, content: string, message: string): Promise<string> {
  await mkdir(join(cwd, path, ".."), { recursive: true });
  await writeFile(join(cwd, path), content);
  await git.run(["add", path]);
  await git.run(["commit", "-q", "-m", message]);
  return git.head();
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "ways-reconcile-"));
  git = new GitRepository(cwd);
  await git.run(["init", "-q", "-b", "main"]);
  await git.run(["config", "user.name", "Ways Test"]);
  await git.run(["config", "user.email", "ways@example.test"]);
  initial = await commit("src/a.ts", "export const a = 1;\n", "initial");
  state = {
    schemaVersion: 1,
    generation: 3,
    watermark: { revision: initial, digest: await canonicalCodeTreeDigest(git, initial, config), reviewDigest: "a".repeat(64) },
  };
  await git.run(["switch", "-q", "-c", "development"]);
  snapshot = await commit("src/b.ts", "export const b = 1;\n", "feature");
  await git.run(["switch", "-q", "-c", "reconcile/4"]);
  reconcile = await commit(".ways/knowledge/components/runtime.md", "---\ntype: component\nstatus: draft\n---\n", "memory");
});

function request(dispositions = [{ path: "src/b.ts", outcome: "updated" as const, concepts: ["components/runtime"] }]) {
  return {
    state,
    candidateRef: snapshot,
    reconcileRef: reconcile,
    targetRef: "main",
    candidateBranch: "reconcile/4",
    dispositions,
    unresolvedClaims: [],
  };
}

async function reviewedRequest(dispositions = request().dispositions) {
  const input = request(dispositions);
  const draft = await inspectReconciliationCandidate(cwd, config, input);
  return { ...input, reviewDigest: await reconciliationReviewDigest(git, snapshot, reconcile, draft.evidence) };
}

async function evidence(): Promise<ReconciliationEvidence> {
  const result = await inspectReconciliationCandidate(cwd, config, await reviewedRequest());
  expect(result.issues).toEqual([]);
  return result.evidence;
}

describe("reconciliation candidates", () => {
  it("binds a serial generation to the exact proposed relevant tree and dispositions", async () => {
    const result = await inspectReconciliationCandidate(cwd, config, await reviewedRequest());
    expect(result.issues).toEqual([]);
    expect(result.evidence).toMatchObject({ generation: 4, base: initial, candidate: snapshot, target: initial });
    expect(result.changedRelevantPaths).toEqual(["src/b.ts"]);
    expect(result.evidence.codeTreeDigest).toBe(await canonicalCodeTreeDigest(git, snapshot, config));
    expect(reconciliationPayloadDigest(result.evidence)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fails closed on omissions, duplicate/extraneous dispositions, and missing claim assessment", async () => {
    const omittedInput = await reviewedRequest([]);
    const omitted = await inspectReconciliationCandidate(cwd, config, { ...omittedInput, unresolvedClaims: undefined });
    expect(omitted.issues.map((entry) => entry.code)).toEqual(expect.arrayContaining(["missing-disposition", "missing-claim-assessment"]));

    const duplicateDispositions = [
      { path: "src/b.ts", outcome: "updated" as const, concepts: ["components/runtime"] },
      { path: "src/b.ts", outcome: "confirmed" as const, concepts: ["components/runtime"] },
      { path: "src/nope.ts", outcome: "implementation-detail" as const, concepts: [] },
    ];
    const duplicate = await inspectReconciliationCandidate(cwd, config, await reviewedRequest(duplicateDispositions));
    expect(duplicate.issues.map((entry) => entry.code)).toEqual(expect.arrayContaining(["duplicate-disposition", "extraneous-disposition", "missing-disposition-path"]));
  });

  it("supports trunk candidates without an integration branch", async () => {
    const trunkConfig = { ...config, integrationBranch: undefined };
    const result = await inspectReconciliationCandidate(cwd, trunkConfig, await reviewedRequest());
    expect(result.issues).toEqual([]);
  });

  it("rejects non-memory changes after the immutable snapshot and invalid branch names", async () => {
    const badTip = await commit("src/b.ts", "export const b = 2;\n", "late code");
    const result = await inspectReconciliationCandidate(cwd, config, { ...await reviewedRequest(), reconcileRef: badTip, candidateBranch: "feature/not-reconcile" });
    expect(result.issues.map((entry) => entry.code)).toEqual(expect.arrayContaining(["forbidden-reconciliation-path", "invalid-reconciliation-branch"]));
  });

  it("detects stale targets, concurrent generations, stale review, and appended code", async () => {
    const record = await evidence();
    await git.run(["switch", "-q", "main"]);
    await commit("src/release.ts", "export const release = true;\n", "target moves");
    const moved = await validateReconciliationEvidence(cwd, config, record, {
      state: { ...state, generation: 4 }, reconcileRef: reconcile, currentTargetRef: "main",
      expectedReviewDigest: "c".repeat(64), unresolvedClaims: [],
    });
    expect(moved.map((entry) => entry.code)).toEqual(expect.arrayContaining(["concurrent-generation", "stale-target", "stale-review"]));

    await git.run(["switch", "-q", "reconcile/4"]);
    const badTip = await commit("src/late.ts", "late\n", "late candidate mutation");
    const appended = await validateReconciliationEvidence(cwd, config, record, {
      state, reconcileRef: badTip, currentTargetRef: initial, expectedReviewDigest: record.reviewDigest, unresolvedClaims: [],
    });
    expect(appended.map((entry) => entry.code)).toEqual(expect.arrayContaining(["forbidden-reconciliation-path", "stale-code-tree", "missing-disposition"]));
  });
});

describe("publication and back-sync topology", () => {
  it("accepts only real, ordered publication and back-sync merges and preserves later integration drift", async () => {
    const record = await evidence();
    await git.run(["switch", "-q", "main"]);
    await git.run(["merge", "-q", "--no-ff", "reconcile/4", "-m", "publish"]);
    const publication = await git.head();
    expect((await validatePublicationMerge(cwd, config, record, publication, reconcile)).issues).toEqual([]);

    await git.run(["switch", "-q", "development"]);
    const integrationBefore = await commit("src/later.ts", "export const later = true;\n", "later integration work");
    await git.run(["merge", "-q", "--no-ff", "main", "-m", "back sync"]);
    const backSync = await git.head();
    expect(await validateBackSyncMerge(cwd, config, publication, integrationBefore, backSync)).toEqual({ status: "merged", issues: [] });
    expect(await validateBackSyncMerge(cwd, config, publication, backSync, backSync)).toEqual({ status: "already-synchronized", issues: [] });
    expect(await canonicalCodeTreeDigest(git, backSync, config)).not.toBe(record.codeTreeDigest);
  });

  it("rejects squash/cherry-pick style publication even when content matches", async () => {
    const record = await evidence();
    await git.run(["switch", "-q", "main"]);
    await git.run(["read-tree", reconcile]);
    await git.run(["checkout-index", "-a", "-f"]);
    await git.run(["commit", "-q", "-m", "squashed publication"]);
    const result = await validatePublicationMerge(cwd, config, record, "HEAD", reconcile);
    expect(result.issues.map((entry) => entry.code)).toContain("publication-not-merge");
  });

  it("rejects reversed merge parents and an altered final merge tree", async () => {
    const record = await evidence();
    const reversed = await git.run(["commit-tree", await git.treeId(reconcile), "-p", reconcile, "-p", initial, "-m", "reversed"]);
    expect((await validatePublicationMerge(cwd, config, record, reversed, reconcile)).issues.map((entry) => entry.code))
      .toEqual(expect.arrayContaining(["publication-first-parent", "publication-second-parent"]));

    const badContent = await commit("src/b.ts", "export const b = 99;\n", "unreviewed resolution");
    const altered = await git.run(["commit-tree", await git.treeId(badContent), "-p", initial, "-p", reconcile, "-m", "altered merge"]);
    expect((await validatePublicationMerge(cwd, config, record, altered, reconcile)).issues.map((entry) => entry.code))
      .toEqual(expect.arrayContaining(["publication-tree-mismatch", "publication-final-tree-mismatch"]));
  });
});
