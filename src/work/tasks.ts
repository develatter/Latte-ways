import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { TaskState, WorkState } from "../domain/types.js";
import { stableJson, writeAtomic } from "../fs/files.js";
import { GitRepository } from "../git/git.js";
import { loadState, saveState } from "../state/store.js";

function requireSdd(state: WorkState | undefined): WorkState {
  if (!state || state.mode !== "sdd") throw new Error("No active SDD work");
  return state;
}

export async function addTask(cwd: string, id: string, title: string, dependsOn: string[] = []): Promise<TaskState> {
  const state = requireSdd(await loadState(cwd));
  if (state.phase !== "decompose") throw new Error("Tasks can only be defined during decompose");
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(id)) throw new Error("Task id must be a lowercase slug");
  if (!title.trim()) throw new Error("Task title is required");
  if (state.tasks.some((task) => task.id === id)) throw new Error(`Task already exists: ${id}`);
  for (const dependency of dependsOn) {
    if (!state.tasks.some((task) => task.id === dependency)) throw new Error(`Unknown dependency: ${dependency}`);
  }
  const task: TaskState = { id, title: title.trim(), status: dependsOn.length ? "pending" : "ready", dependsOn, commits: [] };
  state.tasks.push(task);
  state.updatedAt = new Date().toISOString();
  await saveState(cwd, state);
  return task;
}

export async function prepareTask(cwd: string, id: string): Promise<TaskState> {
  const state = requireSdd(await loadState(cwd));
  if (state.phase !== "implement") throw new Error("Task worktrees can only be prepared during implement");
  const task = state.tasks.find((candidate) => candidate.id === id);
  if (!task) throw new Error(`Unknown task: ${id}`);
  const incomplete = task.dependsOn.filter((dependency) => state.tasks.find((candidate) => candidate.id === dependency)?.status !== "completed");
  if (incomplete.length > 0) throw new Error(`Incomplete dependencies: ${incomplete.join(", ")}`);
  if (task.worktree) throw new Error(`Task already prepared: ${id}`);

  const git = new GitRepository(cwd);
  const branch = `ways/${state.id}/${task.id}`;
  const worktree = join(cwd, ".ways", "worktrees", state.id, task.id);
  await mkdir(join(cwd, ".ways", "worktrees", state.id), { recursive: true });
  await git.run(["worktree", "add", "-b", branch, worktree, "HEAD"]);
  await mkdir(join(worktree, ".ways", "runtime"), { recursive: true });
  await writeAtomic(join(worktree, ".ways", "runtime", "task.json"), stableJson({
    schemaVersion: 1,
    workId: state.id,
    task: { id: task.id, title: task.title, dependsOn: task.dependsOn },
    requiredTrailers: { "Harness-Work": state.id, "Harness-Task": task.id },
  }));

  task.branch = branch;
  task.worktree = resolve(worktree);
  task.status = "active";
  state.updatedAt = new Date().toISOString();
  await saveState(cwd, state);
  return task;
}

export async function integrateTask(cwd: string, id: string, commits: string[]): Promise<TaskState> {
  const state = requireSdd(await loadState(cwd));
  if (state.phase !== "implement") throw new Error("Tasks can only be integrated during implement");
  const task = state.tasks.find((candidate) => candidate.id === id);
  if (!task) throw new Error(`Unknown task: ${id}`);
  if (commits.length === 0) throw new Error("At least one commit is required");
  const git = new GitRepository(cwd);
  for (const commit of commits) {
    const info = await git.commitInfo(commit);
    if (info.trailers.work !== state.id || info.trailers.task !== task.id) {
      throw new Error(`Commit ${commit} lacks matching work/task trailers`);
    }
  }
  for (const commit of commits) {
    await git.run(["cherry-pick", commit]);
    task.commits.push(await git.head());
  }
  task.status = "completed";
  for (const candidate of state.tasks) {
    if (candidate.status === "pending" && candidate.dependsOn.every((dependency) => state.tasks.find((item) => item.id === dependency)?.status === "completed")) {
      candidate.status = "ready";
    }
  }
  state.updatedAt = new Date().toISOString();
  await saveState(cwd, state);
  return task;
}
