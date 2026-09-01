import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { bootstrap } from "../src/bootstrap/bootstrap.js";
import { GitRepository } from "../src/git/git.js";
import { saveState } from "../src/state/store.js";
import { integrateTask, prepareTask } from "../src/work/tasks.js";

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
  const task = await prepareTask(cwd, "api");
  const worker = new GitRepository(task.worktree!);
  await writeFile(join(task.worktree!, "api.ts"), "export const api = true;\n");
  const workerCommit = await worker.commit(["api.ts"], "feat: build api", { work: "parallel-work", task: "api" });
  const integrated = await integrateTask(cwd, "api", [workerCommit]);
  expect(integrated.status).toBe("completed");
  expect(integrated.commits).toHaveLength(1);
});
