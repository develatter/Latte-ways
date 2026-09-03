import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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
  await writeFile(join(task.worktree!, "api.ts"), "export const api = true;\n");
  const workerCommit = await worker.commit(["api.ts"], "feat: build api", { work: "parallel-work", task: "api" });
  const integrated = await integrateTask(cwd, "api", [workerCommit]);
  expect(integrated.status).toBe("completed");
  expect(integrated.commits).toHaveLength(1);
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
  await git.commit(await git.changedPaths(), "sdd(review): remediate repair-work to implement", {
    work: "repair-work", phase: "review", state: "remediated-implement", attempt: "1",
  });

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
