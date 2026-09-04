import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { bootstrap } from "../src/bootstrap/bootstrap.js";
import { GitRepository } from "../src/git/git.js";
import { loadState, saveState } from "../src/state/store.js";
import { addTask, assertDelegatedImplementation, integrateTask, prepareTask } from "../src/work/tasks.js";

it("isolates a worker and integrates only traced commits", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "ways-worker-"));
  const git = new GitRepository(cwd);
  await git.run(["init", "-q"]);
  await git.run(["config", "user.name", "Ways Test"]);
  await git.run(["config", "user.email", "ways@example.test"]);
  await writeFile(join(cwd, ".gitkeep"), "");
  await git.run(["add", ".gitkeep"]);
  await git.run(["commit", "-q", "-m", "initial"]);
  await bootstrap({ cwd, testCommand: [process.execPath, "-e", "process.exit(0)"] });
  await git.run(["add", "."]);
  await git.run(["commit", "-q", "-m", "bootstrap"]);
  const head = await git.head();
  await saveState(cwd, {
    schemaVersion: 1, harnessVersion: "0.1.0", id: "parallel-work", mode: "sdd", status: "active",
    profile: "autonomous", phase: "implement", lastCompletedPhase: "decompose", baseCommit: head,
    gateCommit: await git.parent(head), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    tasks: [{ id: "api", title: "Build API", status: "ready", dependsOn: [], commits: [] }],
  });
  await git.commit(await git.changedPaths(), "sdd(decompose): complete parallel-work", { work: "parallel-work", phase: "decompose", state: "completed" });
  const task = await prepareTask(cwd, "api");
  const worker = new GitRepository(task.worktree!);
  const legacyArtifact = ".ways/sdd/parallel-work/implement.md";
  await writeFile(join(task.worktree!, "api.ts"), "export const api = true;\n");
  await mkdir(join(task.worktree!, legacyArtifact, ".."), { recursive: true });
  await writeFile(join(task.worktree!, legacyArtifact), "legacy implementation evidence\n");
  const workerCommit = await worker.commit(["api.ts", legacyArtifact], "feat: build api", { work: "parallel-work", task: "api" });
  const integrated = await integrateTask(cwd, "api", [workerCommit]);
  expect(integrated.status).toBe("completed");
  expect(integrated.commits).toHaveLength(1);
  expect(await readFile(join(cwd, legacyArtifact), "utf8")).toBe("legacy implementation evidence\n");
});

async function prepareArtifactGuardTask(): Promise<{ cwd: string; git: GitRepository; worktree: string }> {
  const cwd = await mkdtemp(join(tmpdir(), "ways-artifact-integration-"));
  const git = new GitRepository(cwd);
  await git.run(["init", "-q"]);
  await git.run(["config", "user.name", "Ways Test"]);
  await git.run(["config", "user.email", "ways@example.test"]);
  await writeFile(join(cwd, ".gitkeep"), "");
  await git.run(["add", ".gitkeep"]);
  await git.run(["commit", "-q", "-m", "initial"]);
  await bootstrap({ cwd, testCommand: [process.execPath, "-e", "process.exit(0)"] });
  await git.run(["add", "."]);
  await git.run(["commit", "-q", "-m", "bootstrap"]);

  const id = "artifact-guard";
  const artifacts = [
    `.ways/sdd/${id}/implement.md`,
    `.ways/sdd/${id}/reviews/latest.json`,
    `.ways/sdd/${id}/approvals/plan.json`,
    `.ways/sdd/${id}/attempts/1/remediation.json`,
  ];
  for (const artifact of artifacts) {
    await mkdir(join(cwd, artifact, ".."), { recursive: true });
    await writeFile(join(cwd, artifact), "certified artifact\n");
  }
  await git.run(["add", "--", ...artifacts]);
  await git.run(["commit", "-q", "--no-verify", "-m", "certify prior artifacts"]);
  const readdedApproval = `.ways/sdd/${id}/approvals/plan.json`;
  await rm(join(cwd, readdedApproval));
  await git.run(["add", "-u", "--", readdedApproval]);
  await git.run(["commit", "-q", "--no-verify", "-m", "delete prior approval"]);
  const priorCheckpoint = await git.head();
  const now = new Date().toISOString();
  await saveState(cwd, {
    schemaVersion: 1, harnessVersion: "0.1.0", id, mode: "sdd", status: "active",
    profile: "autonomous", execution: "delegated", phase: "implement", lastCompletedPhase: "decompose",
    baseCommit: priorCheckpoint, gateCommit: priorCheckpoint, attempt: 2,
    remediation: {
      source: "review", target: "implement", reason: "guard immutable artifacts", priorCheckpoint, attempt: 2, timestamp: now,
      evidence: {
        kind: "review",
        review: { schemaVersion: 1, workId: id, attempt: 1, reviewer: "reviewer", digest: "a".repeat(64), verdict: "fail", findings: [] },
      },
    },
    createdAt: now, updatedAt: now, tasks: [],
  });
  await git.run(["add", "--", ".ways/state/current.json", ".ways/status.json"]);
  await git.run(["commit", "-q", "--no-verify", "-m", "start remediation"]);
  await addTask(cwd, "immutable-attack", "Attempt immutable artifact mutation");
  const task = await prepareTask(cwd, "immutable-attack");
  return { cwd, git, worktree: task.worktree! };
}

it.each([
  ["modifies", ".ways/sdd/artifact-guard/implement.md"],
  ["deletes", ".ways/sdd/artifact-guard/reviews/latest.json"],
  ["re-adds", ".ways/sdd/artifact-guard/approvals/plan.json"],
  ["modifies", ".ways/sdd/artifact-guard/attempts/1/remediation.json"],
])("rejects a task commit that %s an immutable prior artifact: %s", async (action, artifact) => {
  const { cwd, git, worktree } = await prepareArtifactGuardTask();
  const worker = new GitRepository(worktree);
  if (action === "deletes") {
    await rm(join(worktree, artifact));
    await worker.run(["add", "-u", "--", artifact]);
  } else {
    await mkdir(join(worktree, artifact, ".."), { recursive: true });
    await writeFile(join(worktree, artifact), "forged task artifact\n");
    await worker.run(["add", "--", artifact]);
  }
  await worker.run(["commit", "-q", "--no-verify", "-m", "forge immutable artifact", "-m",
    "Harness-Work: artifact-guard\nHarness-Task: immutable-attack\nHarness-Attempt: 2"]);
  const attack = await worker.head();
  const head = await git.head();

  await expect(integrateTask(cwd, "immutable-attack", [attack])).rejects.toThrow(`mutates immutable prior SDD artifact: ${artifact}`);
  expect(await git.head()).toBe(head);
  expect((await loadState(cwd))!.tasks.find((task) => task.id === "immutable-attack")).toMatchObject({ status: "active", commits: [] });
});

it("allows a task commit to change the active attempt artifact", async () => {
  const { cwd, worktree } = await prepareArtifactGuardTask();
  const worker = new GitRepository(worktree);
  const artifact = ".ways/sdd/artifact-guard/attempts/2/implement.md";
  await mkdir(join(worktree, artifact, ".."), { recursive: true });
  await writeFile(join(worktree, artifact), "current task evidence\n");
  const commit = await worker.commit([artifact], "document current task", {
    work: "artifact-guard", task: "immutable-attack", attempt: "2",
  });

  await expect(integrateTask(cwd, "immutable-attack", [commit])).resolves.toMatchObject({ status: "completed", commits: [expect.any(String)] });
});

it("keeps prior tasks immutable and integrates only fresh remediation tasks", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "ways-remediation-worker-"));
  const git = new GitRepository(cwd);
  await git.run(["init", "-q"]);
  await git.run(["config", "user.name", "Ways Test"]);
  await git.run(["config", "user.email", "ways@example.test"]);
  await writeFile(join(cwd, ".gitkeep"), "");
  await git.run(["add", ".gitkeep"]);
  await git.run(["commit", "-q", "-m", "initial"]);
  await bootstrap({ cwd, testCommand: [process.execPath, "-e", "process.exit(0)"] });
  await git.run(["add", "."]);
  await git.run(["commit", "-q", "-m", "bootstrap"]);
  const priorCheckpoint = await git.head();
  const now = new Date().toISOString();
  await saveState(cwd, {
    schemaVersion: 1, harnessVersion: "0.1.0", id: "repair-work", mode: "sdd", status: "active",
    profile: "autonomous", execution: "delegated", phase: "implement", lastCompletedPhase: "decompose",
    baseCommit: priorCheckpoint, gateCommit: priorCheckpoint, attempt: 1,
    remediation: {
      source: "review", target: "implement", reason: "fix failed review", priorCheckpoint, attempt: 1, timestamp: now,
      evidence: {
        kind: "review",
        review: { schemaVersion: 1, workId: "repair-work", reviewer: "reviewer", digest: "a".repeat(64), verdict: "fail", findings: [] },
      },
    },
    createdAt: now, updatedAt: now,
    tasks: [{ id: "api", title: "Old API", status: "completed", dependsOn: [], commits: ["a".repeat(40)] }],
  });
  // This task-focused fixture starts at a synthetic remediation checkpoint; bypass the hook that audits full transition evidence.
  await git.run(["add", "--", ...await git.changedPaths()]);
  await git.run(["commit", "-q", "--no-verify", "-m", "sdd(review): remediate repair-work to implement", "-m",
    "Harness-Work: repair-work\nHarness-Phase: review\nHarness-State: remediated-implement\nHarness-Attempt: 1"]);

  await expect(prepareTask(cwd, "api")).rejects.toThrow(/immutable during attempt 1/);
  await expect(addTask(cwd, "api", "Reuse old name")).rejects.toThrow(/already exists/);
  await expect(assertDelegatedImplementation(cwd, (await loadState(cwd))!)).rejects.toThrow(/newly integrated task/);

  const fresh = await addTask(cwd, "api-review-fix", "Fix API review findings", ["api"]);
  expect(fresh).toMatchObject({ attempt: 1, status: "ready" });
  const prepared = await prepareTask(cwd, fresh.id);
  expect(prepared.branch).toContain("/attempt-1/");
  expect(prepared.worktree).toContain("/attempt-1/");
  const packet = JSON.parse(await readFile(join(prepared.worktree!, ".ways/runtime/task.json"), "utf8")) as {
    attempt: number; task: { attempt: number }; requiredTrailers: Record<string, string>;
  };
  expect(packet).toMatchObject({ attempt: 1, task: { attempt: 1 }, requiredTrailers: { "Harness-Attempt": "1" } });

  const worker = new GitRepository(prepared.worktree!);
  await writeFile(join(prepared.worktree!, "fix.ts"), "export const fixed = true;\n");
  const workerCommit = await worker.commit(["fix.ts"], "fix: api review", { work: "repair-work", task: fresh.id, attempt: "1" });
  await integrateTask(cwd, fresh.id, [workerCommit]);
  await expect(assertDelegatedImplementation(cwd, (await loadState(cwd))!)).resolves.toBeUndefined();

  await writeFile(join(cwd, "forged.ts"), "// orchestrator\n");
  await git.commit(["forged.ts"], "fix: forged remediation", { work: "repair-work", task: fresh.id, attempt: "1" });
  await expect(assertDelegatedImplementation(cwd, (await loadState(cwd))!)).rejects.toThrow(/not integrated from a task in the current attempt/);
});
