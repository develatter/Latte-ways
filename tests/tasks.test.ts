import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bootstrap } from "../src/bootstrap/bootstrap.js";
import { GitRepository } from "../src/git/git.js";
import { saveState } from "../src/state/store.js";
import { addTask } from "../src/work/tasks.js";

it("models task dependencies during decomposition", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "ways-tasks-"));
  const git = new GitRepository(cwd);
  await git.run(["init", "-q"]);
  await git.run(["config", "user.name", "Ways Test"]);
  await git.run(["config", "user.email", "ways@example.test"]);
  await writeFile(join(cwd, ".gitkeep"), "");
  await git.run(["add", ".gitkeep"]);
  await git.run(["commit", "-q", "-m", "initial"]);
  await bootstrap({ cwd, testCommand: [process.execPath, "-e", "process.exit(0)"] });
  const head = await git.head();
  await saveState(cwd, {
    schemaVersion: 1, harnessVersion: "0.1.0", id: "work", mode: "sdd", status: "active",
    profile: "autonomous", phase: "decompose", baseCommit: head, gateCommit: head,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tasks: [],
  });
  await addTask(cwd, "api", "Build API");
  const ui = await addTask(cwd, "ui", "Build UI", ["api"]);
  expect(ui.status).toBe("pending");
  await expect(addTask(cwd, "docs", "Write docs", ["missing"])).rejects.toThrow("Unknown dependency");
});
