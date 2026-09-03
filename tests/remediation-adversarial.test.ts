import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bootstrap } from "../src/bootstrap/bootstrap.js";
import { run } from "../src/cli.js";
import { GitRepository } from "../src/git/git.js";
import { checkHistory } from "../src/integrity/history.js";
import { readStatus } from "../src/state/status.js";
import { loadState } from "../src/state/store.js";
import { attemptPhasePath, attemptReviewPath } from "../src/work/attempt.js";
import { implementationCycleBaseline, workDigest } from "../src/work/digest.js";
import { remediateSdd } from "../src/work/remediation.js";
import { reviewDigest } from "../src/work/review.js";
import { advanceSdd, startSdd } from "../src/work/sdd.js";
import { addTask, integrateTask, prepareTask } from "../src/work/tasks.js";

async function repository(): Promise<{ cwd: string; git: GitRepository }> {
  const cwd = await mkdtemp(join(tmpdir(), "ways-remediation-adversarial-"));
  const git = new GitRepository(cwd);
  await git.run(["init", "-q"]);
  await git.run(["config", "user.name", "Ways Test"]);
  await git.run(["config", "user.email", "ways@example.test"]);
  await writeFile(join(cwd, ".gitkeep"), "");
  await git.commit([".gitkeep"], "initial", {});
  await bootstrap({ cwd, testCommand: [process.execPath, "-e", "process.exit(0)"] });
  await git.run(["add", "."]);
  await git.run(["commit", "-q", "-m", "bootstrap"]);
  return { cwd, git };
}

async function fillCurrentPhase(cwd: string, id: string): Promise<void> {
  const state = (await loadState(cwd))!;
  const path = join(cwd, attemptPhasePath(id, state.attempt, state.phase!));
  const content = await readFile(path, "utf8");
  await writeFile(path, content.replace("Goal:", `Goal: complete ${state.phase}`).replace("Evidence:", "Evidence: adversarial lifecycle"));
}

async function integrateFileTask(cwd: string, id: string, taskId: string, filename: string): Promise<string> {
  const task = await prepareTask(cwd, taskId);
  const worker = new GitRepository(task.worktree!);
  await writeFile(join(task.worktree!, filename), `export const ${taskId.replaceAll("-", "_")} = true;\n`);
  const state = (await loadState(cwd))!;
  const workerCommit = await worker.commit([filename], `feat: ${taskId}`, {
    work: id,
    task: taskId,
    ...(state.attempt ? { attempt: String(state.attempt) } : {}),
  });
  await integrateTask(cwd, taskId, [workerCommit]);
  return (await loadState(cwd))!.tasks.find((candidate) => candidate.id === taskId)!.commits[0]!;
}

async function submitFailedReview(cwd: string, id: string, attempt?: number): Promise<void> {
  const input = join(await mkdtemp(join(tmpdir(), "ways-review-input-")), "review.json");
  await writeFile(input, JSON.stringify({
    schemaVersion: 1,
    workId: id,
    ...(attempt === undefined ? {} : { attempt }),
    reviewer: "independent reviewer",
    digest: await reviewDigest(cwd),
    verdict: "fail",
    findings: [{ id: "R1", severity: "high", summary: "requires remediation", disposition: "open" }],
  }));
  expect(await run(["review", "submit", input], cwd)).toBe(0);
}

describe("adversarial remediation lifecycle", { timeout: 120_000 }, () => {
  it("keeps certified attempt-zero artifacts immutable while rejecting stale, staged, and wrong-attempt review evidence", async () => {
    const { cwd, git } = await repository();
    const id = "evidence-loop";
    await startSdd(cwd, id, "autonomous");
    for (const _phase of ["intake", "explore", "assess", "specify", "plan", "decompose", "implement"]) {
      await fillCurrentPhase(cwd, id);
      await advanceSdd(cwd);
    }
    await submitFailedReview(cwd, id);

    const reviewPath = join(cwd, attemptReviewPath(id, 0));
    const originalReview = await readFile(reviewPath, "utf8");
    const implementPath = join(cwd, attemptPhasePath(id, 0, "implement"));
    const certifiedImplement = await readFile(implementPath, "utf8");
    const prior = await git.head();

    await writeFile(reviewPath, JSON.stringify({ ...JSON.parse(originalReview), attempt: 1 }));
    await expect(remediateSdd(cwd, "implement", "wrong attempt evidence")).rejects.toThrow(/another work or remediation attempt/);
    expect(await git.head()).toBe(prior);
    await writeFile(reviewPath, originalReview);

    await writeFile(implementPath, `${certifiedImplement}\nTampered after certification.\n`);
    await expect(remediateSdd(cwd, "implement", "stale certified artifact")).rejects.toThrow(/stale/);
    expect(await git.head()).toBe(prior);
    await git.run(["add", implementPath]);
    await expect(remediateSdd(cwd, "implement", "staged certified artifact")).rejects.toThrow(/stale/);
    expect(await git.head()).toBe(prior);
    await git.run(["reset", "--", implementPath]);
    await writeFile(implementPath, certifiedImplement);

    await remediateSdd(cwd, "implement", "repair the independent finding");
    expect(await git.run(["show", `${prior}:${attemptPhasePath(id, 0, "implement")}`])).toBe(certifiedImplement.trim());
    expect(await readFile(join(cwd, attemptPhasePath(id, 0, "implement")), "utf8")).toBe(certifiedImplement);
    expect((await loadState(cwd))?.remediation).toMatchObject({ source: "review", target: "implement", attempt: 1 });
  });

  it("requires newly integrated delegated remediation work and binds the digest to both initial implementation commits", async () => {
    const { cwd, git } = await repository();
    const id = "delegated-loop";
    await startSdd(cwd, id, "autonomous", "delegated");
    for (const _phase of ["intake", "explore", "assess", "specify", "plan"]) {
      await fillCurrentPhase(cwd, id);
      await advanceSdd(cwd);
    }
    await addTask(cwd, "initial-one", "First implementation commit");
    await addTask(cwd, "initial-two", "Last implementation commit");
    await fillCurrentPhase(cwd, id);
    await advanceSdd(cwd);
    await fillCurrentPhase(cwd, id);
    const first = await integrateFileTask(cwd, id, "initial-one", "first.ts");
    const last = await integrateFileTask(cwd, id, "initial-two", "last.ts");
    await advanceSdd(cwd);
    const reviewState = (await loadState(cwd))!;
    const baseline = await implementationCycleBaseline(cwd, reviewState);
    const completeDigest = await workDigest(cwd, baseline);
    expect(completeDigest).not.toBe(await workDigest(cwd, first));
    expect(completeDigest).not.toBe(await workDigest(cwd, last));
    expect(await reviewDigest(cwd)).toBe(completeDigest);
    await submitFailedReview(cwd, id);

    const initialImplement = await git.run(["show", `HEAD:${attemptPhasePath(id, 0, "implement")}`]);
    expect(await run(["sdd", "remediate", "implement", "--reason=replace delegated implementation"], cwd)).toBe(0);
    expect(await readStatus(cwd)).toMatchObject({
      phase: "implement", execution: "delegated", attempt: 1,
      remediation: { source: "review", target: "implement" },
    });
    await expect(prepareTask(cwd, "initial-one")).rejects.toThrow(/immutable during attempt 1/);
    await addTask(cwd, "remediation-fix", "Fresh remediation implementation", ["initial-one"]);
    const remediationCommit = await integrateFileTask(cwd, id, "remediation-fix", "fix.ts");
    expect(remediationCommit).toMatch(/^[0-9a-f]{40}$/);
    await fillCurrentPhase(cwd, id);

    await writeFile(join(cwd, "forged.ts"), "export const forged = true;\n");
    await git.commit(["forged.ts"], "feat: forged orchestrator write", { work: id, task: "remediation-fix", attempt: "1" });
    await expect(advanceSdd(cwd)).rejects.toThrow(/not integrated from a task in the current attempt/);
    expect((await readFile(join(cwd, attemptPhasePath(id, 0, "implement")), "utf8")).trim()).toBe(initialImplement);
    expect(await checkHistory(cwd)).toEqual([]);
  });
});
