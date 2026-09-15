import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { STATE_PATH, STATUS_PATH } from "../domain/constants.js";
import { recordVersion, type LifecycleContract } from "../domain/lifecycle.js";
import type { TaskState, WorkState } from "../domain/types.js";
import { stableJson, writeAtomic } from "../fs/files.js";
import { commitsAfter } from "../integrity/history.js";
import { GitRepository } from "../git/git.js";
import { loadState, saveState } from "../state/store.js";
import { attemptPhasePath, isPriorAttemptArtifact, remediationTransitionCommit } from "./attempt.js";

function requireSdd(state: WorkState | undefined): WorkState {
  if (!state || state.mode !== "sdd") throw new Error("No active SDD work");
  return state;
}

function taskAttempt(task: TaskState, contract: LifecycleContract): number {
  return contract.attemptNumber(task.attempt, `task ${task.id}`);
}

function requireCurrentTask(state: WorkState, id: string, contract: LifecycleContract): TaskState {
  const task = state.tasks.find((candidate) => candidate.id === id);
  if (!task) throw new Error(`Unknown task: ${id}`);
  const currentAttempt = contract.attemptNumber(state.attempt);
  const existingAttempt = taskAttempt(task, contract);
  if (existingAttempt !== currentAttempt) {
    throw new Error(`Task ${id} belongs to attempt ${existingAttempt} and is immutable during attempt ${currentAttempt}`);
  }
  return task;
}

function canAddTask(state: WorkState, contract: LifecycleContract): boolean {
  return state.phase === contract.decomposePhase
    || (state.phase === contract.implementPhase && contract.attemptNumber(state.attempt) > 0 && state.remediation?.attempt === state.attempt);
}

function taskAttemptTrailer(value: string | undefined, attempt: number, contract: LifecycleContract): boolean {
  return contract.attemptTrailerMatches(value, attempt);
}

export async function addTask(cwd: string, id: string, title: string, dependsOn: string[] = []): Promise<TaskState> {
  const state = requireSdd(await loadState(cwd));
  const contract = recordVersion(state, "SDD state");
  if (!canAddTask(state, contract)) throw new Error("Tasks can only be defined during decompose or remediated implement");
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(id)) throw new Error("Task id must be a lowercase slug");
  if (!title.trim()) throw new Error("Task title is required");
  if (state.tasks.some((task) => task.id === id)) throw new Error(`Task already exists: ${id}`);
  for (const dependency of dependsOn) {
    if (!state.tasks.some((task) => task.id === dependency)) throw new Error(`Unknown dependency: ${dependency}`);
  }
  const task: TaskState = {
    id,
    title: title.trim(),
    attempt: contract.attemptNumber(state.attempt),
    status: dependsOn.some((dependency) => state.tasks.find((task) => task.id === dependency)?.status !== "completed") ? "pending" : "ready",
    dependsOn,
    commits: [],
  };
  state.tasks.push(task);
  state.updatedAt = new Date().toISOString();
  await saveState(cwd, state);
  return task;
}
export async function prepareTask(cwd: string, id: string): Promise<TaskState> {
  const state = requireSdd(await loadState(cwd));
  const contract = recordVersion(state, "SDD state");
  if (state.phase !== contract.implementPhase) throw new Error("Task worktrees can only be prepared during implement");
  const task = requireCurrentTask(state, id, contract);
  const incomplete = task.dependsOn.filter((dependency) => state.tasks.find((candidate) => candidate.id === dependency)?.status !== "completed");
  if (incomplete.length > 0) throw new Error(`Incomplete dependencies: ${incomplete.join(", ")}`);
  if (task.worktree) throw new Error(`Task already prepared: ${id}`);
  if (task.status !== "ready") throw new Error(`Task is not ready: ${id}`);

  const attempt = contract.attemptNumber(state.attempt);
  const git = new GitRepository(cwd);
  const branch = `ways/${state.id}/attempt-${attempt}/${task.id}`;
  const worktree = join(cwd, ".ways", "worktrees", state.id, `attempt-${attempt}`, task.id);
  await mkdir(join(cwd, ".ways", "worktrees", state.id, `attempt-${attempt}`), { recursive: true });
  await git.run(["worktree", "add", "-b", branch, worktree, "HEAD"]);
  await mkdir(join(worktree, ".ways", "runtime"), { recursive: true });
  await writeAtomic(join(worktree, ".ways", "runtime", "task.json"), stableJson({
    schemaVersion: 1,
    workId: state.id,
    attempt,
    task: { id: task.id, title: task.title, attempt, dependsOn: task.dependsOn },
    requiredTrailers: { "Harness-Work": state.id, "Harness-Task": task.id, "Harness-Attempt": String(attempt) },
  }));

  task.branch = branch;
  task.worktree = resolve(worktree);
  task.status = "active";
  state.updatedAt = new Date().toISOString();
  await saveState(cwd, state);
  return task;
}

async function priorArtifactChangedBy(git: GitRepository, commit: string, workId: string, attempt: number): Promise<string | undefined> {
  const paths = (await git.run(["diff-tree", "--no-commit-id", "--no-renames", "--name-only", "-r", "--root", "-z", commit]))
    .split("\0").filter(Boolean);
  return paths.find((path) => isPriorAttemptArtifact(path, workId, attempt));
}

export async function integrateTask(cwd: string, id: string, commits: string[]): Promise<TaskState> {
  const state = requireSdd(await loadState(cwd));
  const contract = recordVersion(state, "SDD state");
  if (state.phase !== contract.implementPhase) throw new Error("Tasks can only be integrated during implement");
  const task = requireCurrentTask(state, id, contract);
  if (task.status !== "active" || !task.branch || !task.worktree) throw new Error(`Task must be prepared before integration: ${id}`);
  if (commits.length === 0) throw new Error("At least one commit is required");
  const attempt = contract.attemptNumber(state.attempt);
  const git = new GitRepository(cwd);
  for (const commit of commits) {
    const info = await git.commitInfo(commit);
    if (info.trailers.work !== state.id || info.trailers.task !== task.id || !taskAttemptTrailer(info.trailers.attempt, attempt, contract)) {
      throw new Error(`Commit ${commit} lacks matching work/task/attempt trailers`);
    }
    if (!await git.isAncestor(info.hash, task.branch)) {
      throw new Error(`Commit ${commit} does not belong to task branch ${task.branch}`);
    }
    if (await git.isAncestor(info.hash)) throw new Error(`Commit ${commit} is already present in the orchestrator history`);
    const immutablePath = await priorArtifactChangedBy(git, info.hash, state.id, attempt);
    if (immutablePath) throw new Error(`Commit ${commit} mutates immutable prior SDD artifact: ${immutablePath}`);
  }
  for (const commit of commits) {
    await git.run(["cherry-pick", commit]);
    task.commits.push(await git.head());
  }
  task.status = "completed";
  for (const candidate of state.tasks) {
    if (taskAttempt(candidate, contract) === attempt && candidate.status === "pending" && candidate.dependsOn.every((dependency) => state.tasks.find((item) => item.id === dependency)?.status === "completed")) {
      candidate.status = "ready";
    }
  }
  state.updatedAt = new Date().toISOString();
  await saveState(cwd, state);
  return task;
}

async function remediationTransitionAnchor(git: GitRepository, state: WorkState, contract: LifecycleContract): Promise<string> {
  const remediation = state.remediation;
  const attempt = contract.attemptNumber(state.attempt);
  if (!remediation || remediation.attempt !== attempt || attempt === 0) throw new Error("Remediated delegated execution lacks current attempt metadata");
  try {
    return await remediationTransitionCommit(git, state.id, remediation);
  } catch {
    throw new Error("Remediation transition is missing or does not follow its prior checkpoint");
  }
}

export async function assertDelegatedCertificationTree(cwd: string, state: WorkState): Promise<void> {
  const contract = recordVersion(state, "SDD state");
  const git = new GitRepository(cwd);
  const allowed = new Set([
    STATE_PATH,
    STATUS_PATH,
    attemptPhasePath(state.id, state.attempt, contract.implementPhase),
  ]);
  const commands = [
    ["diff", "--name-only"],
    ["diff", "--cached", "--name-only"],
    ["ls-files", "--others", "--exclude-standard"],
  ] as const;
  const changed = new Set<string>();
  for (const command of commands) {
    for (const path of (await git.run(command)).split("\n")) if (path) changed.add(path);
  }
  const unrelated = [...changed].filter((path) => !allowed.has(path)).sort();
  if (unrelated.length > 0) {
    throw new Error(`Dirty or staged content outside delegated implementation orchestration blocks certification: ${unrelated.join(", ")}`);
  }
}

/** Enforce provenance from the current implementation cycle, not merely forgeable trailers or index contents. */
export async function assertDelegatedImplementation(cwd: string, state: WorkState): Promise<void> {
  const contract = recordVersion(state, "SDD state");
  const attempt = contract.attemptNumber(state.attempt);
  const currentTasks = state.tasks.filter((task) => taskAttempt(task, contract) === attempt);
  if (currentTasks.length === 0) {
    throw new Error(attempt === 0
      ? "Delegated execution requires at least one task; declare tasks during decompose"
      : "Delegated remediation requires at least one newly integrated task");
  }
  const integrated = new Set(currentTasks.flatMap((task) => task.commits));

  const git = new GitRepository(cwd);
  const anchor = attempt === 0 ? state.gateCommit : await remediationTransitionAnchor(git, state, contract);
  let observedIntegration = false;
  for (const commit of await commitsAfter(git, anchor)) {
    const certificationPhase = commit.trailers.phase;
    const currentCertification = commit.trailers.work === state.id
      && commit.trailers.state === "completed"
      && contract.isPhase(certificationPhase)
      && contract.attemptTrailerMatches(commit.trailers.attempt, attempt)
      && !commit.trailers.task;
    if (integrated.has(commit.hash)) {
      observedIntegration = true;
      continue;
    }
    if (currentCertification) continue;
    throw new Error(`Commit ${commit.hash.slice(0, 12)} "${commit.subject}" was not integrated from a task in the current attempt; the orchestrator must not implement in delegated execution`);
  }
  if (attempt > 0 && !observedIntegration) throw new Error("Delegated remediation requires at least one newly integrated task");
}
