import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bootstrap } from "../src/bootstrap/bootstrap.js";
import type { RemediationTarget, WorkState } from "../src/domain/types.js";
import { GitRepository } from "../src/git/git.js";
import { loadState, saveState } from "../src/state/store.js";
import { approveInteractively } from "../src/work/approve.js";
import { attemptPhasePath, attemptReviewPath, remediationRecordPath } from "../src/work/attempt.js";
import { reviewDigest, submitReview } from "../src/work/review.js";
import { remediateSdd } from "../src/work/remediation.js";
import { advanceSdd } from "../src/work/sdd.js";

const targets: RemediationTarget[] = ["implement", "decompose", "plan", "specify"];

async function baseRepository(testExit = 0): Promise<{ cwd: string; git: GitRepository; base: string }> {
  const cwd = await mkdtemp(join(tmpdir(), "ways-remediate-"));
  const git = new GitRepository(cwd);
  await git.run(["init", "-q"]);
  await git.run(["config", "user.name", "Ways Test"]);
  await git.run(["config", "user.email", "ways@example.test"]);
  await writeFile(join(cwd, ".gitkeep"), "");
  await git.commit([".gitkeep"], "initial", {});
  await bootstrap({ cwd, testCommand: [process.execPath, "-e", `process.exit(${testExit})`] });
  await git.run(["add", "."]);
  await git.run(["commit", "-q", "-m", "bootstrap"]);
  // Synthetic lifecycle setup commits are intentionally assembled directly.
  await git.run(["config", "core.hooksPath", "/dev/null"]);
  return { cwd, git, base: await git.head() };
}

async function reviewRepository(profile: "autonomous" | "supervised" = "autonomous"): Promise<{ cwd: string; git: GitRepository; reviewPath: string; prior: string }> {
  const { cwd, git, base } = await baseRepository();
  await mkdir(join(cwd, ".ways/sdd/failing"), { recursive: true });
  await writeFile(join(cwd, ".ways/sdd/failing/decompose.md"), "# decompose\n\nGoal: split\nEvidence: tasks\n");
  const decompose = await git.commit([".ways/sdd/failing/decompose.md"], "decompose", { work: "failing", phase: "decompose", state: "completed" });
  await writeFile(join(cwd, "implementation.ts"), "export const value = 1;\n");
  const now = new Date().toISOString();
  const state: WorkState = {
    schemaVersion: 1, harnessVersion: "test", id: "failing", mode: "sdd", status: "active",
    profile, phase: "review", lastCompletedPhase: "implement", baseCommit: base,
    gateCommit: decompose, createdAt: now, updatedAt: now, tasks: [],
  };
  await writeFile(join(cwd, ".ways/sdd/failing/review.md"), "# review\n\nGoal:\nEvidence:\nDecision:\nGate:\n");
  await saveState(cwd, state);
  await git.commit(await git.changedPaths(), "implement", { work: "failing", phase: "implement", state: "completed" });
  const digest = await reviewDigest(cwd);
  const reviewPath = attemptReviewPath("failing", 0);
  await mkdir(join(cwd, reviewPath, ".."), { recursive: true });
  await writeFile(join(cwd, reviewPath), JSON.stringify({
    schemaVersion: 1, workId: "failing", reviewer: "independent", digest, verdict: "fail", findings: [],
  }, null, 2) + "\n");
  return { cwd, git, reviewPath, prior: await git.head() };
}

async function validateRepository(testExit = 7): Promise<{ cwd: string; git: GitRepository; prior: string }> {
  const { cwd, git, base } = await baseRepository(testExit);
  await mkdir(join(cwd, ".ways/sdd/failing"), { recursive: true });
  await writeFile(join(cwd, ".ways/sdd/failing/review.md"), "# review\n\nGoal: inspect\nEvidence: pass\n");
  const reviewParent = await git.commit([".ways/sdd/failing/review.md"], "implement", { work: "failing", phase: "implement", state: "completed" });
  const now = new Date().toISOString();
  await writeFile(join(cwd, ".ways/sdd/failing/validate.md"), "# validate\n\nGoal:\nEvidence:\nDecision:\nGate:\n");
  await saveState(cwd, {
    schemaVersion: 1, harnessVersion: "test", id: "failing", mode: "sdd", status: "active",
    profile: "autonomous", phase: "validate", lastCompletedPhase: "review", baseCommit: base,
    gateCommit: reviewParent, createdAt: now, updatedAt: now, tasks: [],
  });
  await git.commit(await git.changedPaths(), "review", { work: "failing", phase: "review", state: "completed" });
  return { cwd, git, prior: await git.head() };
}

async function expectTransition(cwd: string, git: GitRepository, source: "review" | "validate", target: RemediationTarget, prior: string): Promise<void> {
  const oldSource = await readFile(join(cwd, `.ways/sdd/failing/${source}.md`), "utf8");
  const hash = await remediateSdd(cwd, target, ` address ${source} failure `);
  const state = (await loadState(cwd))!;
  expect(state).toMatchObject({ phase: target, attempt: 1, gateCommit: prior, remediation: { source, target, attempt: 1, reason: `address ${source} failure` } });
  expect(state.lastCompletedPhase).toBeUndefined();
  expect(await readFile(join(cwd, `.ways/sdd/failing/${source}.md`), "utf8")).toBe(oldSource);
  expect(await readFile(join(cwd, attemptPhasePath("failing", 1, target)), "utf8")).toContain(`# ${target}`);
  const record = JSON.parse(await readFile(join(cwd, remediationRecordPath("failing", 1)), "utf8"));
  expect(record).toMatchObject({ source, target, attempt: 1, priorCheckpoint: prior });
  expect(record.evidence.kind).toBe(source);
  const commit = await git.commitInfo(hash);
  expect(await git.parent(hash)).toBe(prior);
  expect(commit.trailers).toMatchObject({ work: "failing", phase: source, state: `remediated-${target}`, attempt: "1" });
}

describe("SDD remediation transitions", { timeout: 120_000 }, () => {
  for (const source of ["review", "validate"] as const) {
    for (const target of targets) {
      it(`${source} -> ${target} is additive and evidence gated`, async () => {
        const fixture = source === "review" ? await reviewRepository() : await validateRepository();
        await expectTransition(fixture.cwd, fixture.git, source, target, fixture.prior);
      });
    }
  }

  it.each([
    ["missing", undefined],
    ["malformed", "{"],
    ["passing", "pass"],
  ])("rejects %s review evidence without changing state", async (_label, evidence) => {
    const { cwd, git, reviewPath, prior } = await reviewRepository();
    if (evidence === undefined) await git.run(["clean", "-f", "--", reviewPath]);
    else if (evidence === "{") await writeFile(join(cwd, reviewPath), evidence);
    else {
      const review = JSON.parse(await readFile(join(cwd, reviewPath), "utf8"));
      await writeFile(join(cwd, reviewPath), JSON.stringify({ ...review, verdict: "pass" }));
    }
    await expect(remediateSdd(cwd, "implement", "fix it")).rejects.toThrow();
    expect(await git.head()).toBe(prior);
    expect((await loadState(cwd))?.attempt).toBeUndefined();
  });

  it("rejects stale review evidence and unrelated staged or dirty content without mutation", async () => {
    const { cwd, git, prior } = await reviewRepository();
    await writeFile(join(cwd, "implementation.ts"), "export const value = 2;\n");
    await expect(remediateSdd(cwd, "implement", "fix it")).rejects.toThrow(/stale/);
    expect(await git.head()).toBe(prior);
    await git.run(["checkout", "--", "implementation.ts"]);
    await writeFile(join(cwd, "unrelated.txt"), "no\n");
    await git.run(["add", "unrelated.txt"]);
    await expect(remediateSdd(cwd, "implement", "fix it")).rejects.toThrow();
    expect(await git.head()).toBe(prior);
    expect((await loadState(cwd))?.attempt).toBeUndefined();
  });

  it("moves reopened phases forward to fresh attempt-scoped review and validation", async () => {
    const { cwd } = await reviewRepository();
    await remediateSdd(cwd, "specify", "revise requirements");
    for (const phase of ["specify", "plan", "decompose", "implement"] as const) {
      const path = join(cwd, attemptPhasePath("failing", 1, phase));
      const content = await readFile(path, "utf8");
      await writeFile(path, content.replace("Goal:", "Goal: continue").replace("Evidence:", "Evidence: current attempt"));
      await advanceSdd(cwd);
    }
    expect((await loadState(cwd))?.phase).toBe("review");
    const reviewPhase = join(cwd, attemptPhasePath("failing", 1, "review"));
    const content = await readFile(reviewPhase, "utf8");
    await writeFile(reviewPhase, content.replace("Goal:", "Goal: review").replace("Evidence:", "Evidence: fresh pass"));
    const input = join(await mkdtemp(join(tmpdir(), "ways-review-input-")), "fresh-review.json");
    await writeFile(input, JSON.stringify({
      schemaVersion: 1, workId: "failing", attempt: 1, reviewer: "fresh reviewer",
      digest: await reviewDigest(cwd), verdict: "pass", findings: [],
    }));
    await submitReview(cwd, input);
    await advanceSdd(cwd);
    expect((await loadState(cwd))?.phase).toBe("validate");
    expect(await readFile(join(cwd, attemptPhasePath("failing", 1, "validate")), "utf8")).toContain("# validate");
  });

  it("requires a fresh attempt-scoped approval at a reopened supervised plan gate", async () => {
    const { cwd } = await reviewRepository("supervised");
    await remediateSdd(cwd, "plan", "revise plan");
    const path = join(cwd, attemptPhasePath("failing", 1, "plan"));
    const content = await readFile(path, "utf8");
    await writeFile(path, content.replace("Goal:", "Goal: plan again").replace("Evidence:", "Evidence: review failure"));
    await expect(advanceSdd(cwd)).rejects.toThrow(/human approval/);
    await approveInteractively(cwd, { interactive: true, ask: async () => "plan", say: () => undefined });
    await expect(advanceSdd(cwd)).resolves.toBeTruthy();
    expect((await loadState(cwd))?.phase).toBe("decompose");
  });

  it("rejects passing validation and empty reasons without mutation", async () => {
    const passing = await validateRepository(0);
    await expect(remediateSdd(passing.cwd, "implement", "fix it")).rejects.toThrow(/Passing validation/);
    expect(await passing.git.head()).toBe(passing.prior);
    expect((await loadState(passing.cwd))?.attempt).toBeUndefined();

    await expect(remediateSdd(passing.cwd, "implement", "   ")).rejects.toThrow(/nonempty/);
    expect(await passing.git.head()).toBe(passing.prior);
  });
});
