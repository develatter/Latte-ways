import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { HARNESS_VERSION } from "../index.js";
import { runChecks } from "../check/check.js";
import { PLAN_DIR, SDD_DIR } from "../domain/constants.js";
import { SDD_PHASES, type ApprovalProfile, type ExecutionMode, type SddPhase, type WorkState } from "../domain/types.js";
import { writeAtomic } from "../fs/files.js";
import { GitRepository } from "../git/git.js";
import { commitsAfter } from "../integrity/history.js";
import { HUMAN_GATES } from "../state/status.js";
import { loadState, removeState, saveState } from "../state/store.js";
import { assertReviewPassed } from "./review.js";

function phasePath(state: WorkState, phase: SddPhase): string {
  return `${SDD_DIR}/${state.id}/${phase}.md`;
}

function phaseTemplate(phase: SddPhase): string {
  return `# ${phase}\n\nGoal:\nEvidence:\nDecision:\nGate:\n`;
}

async function createPhaseFile(cwd: string, state: WorkState, phase: SddPhase): Promise<void> {
  const path = join(cwd, phasePath(state, phase));
  await mkdir(join(cwd, SDD_DIR, state.id), { recursive: true });
  await writeAtomic(path, phaseTemplate(phase));
}

async function assertPhaseFilled(cwd: string, state: WorkState): Promise<void> {
  if (!state.phase) throw new Error("SDD state has no phase");
  const content = await readFile(join(cwd, phasePath(state, state.phase)), "utf8");
  const values = content.split("\n").filter((line) => /^(Goal|Evidence|Decision|Gate):\s*\S/.test(line));
  if (values.length < 2) throw new Error(`Phase ${state.phase} lacks evidence and a gate decision`);
}

export async function assertSddConsistency(cwd: string, state: WorkState): Promise<void> {
  const git = new GitRepository(cwd);
  const head = await git.head();
  if (!state.lastCompletedPhase) {
    if (head !== state.baseCommit) throw new Error("SDD state diverged before its first gate; run ways repair");
    return;
  }
  const commit = await git.findCertification(state.id, state.lastCompletedPhase);
  if (!commit || !await git.isAncestor(commit.hash, head)) {
    throw new Error("HEAD does not contain certification for the previous SDD phase; run ways repair");
  }
  if (await git.parent(commit.hash) !== state.gateCommit) throw new Error("State gate commit does not match certification parent; run ways repair");
}

/** In delegated execution every implementation commit must come from an integrated task. */
async function assertDelegatedImplementation(cwd: string, state: WorkState): Promise<void> {
  if (state.tasks.length === 0) throw new Error("Delegated execution requires at least one task; declare tasks during decompose");
  const git = new GitRepository(cwd);
  for (const commit of await commitsAfter(git, state.gateCommit)) {
    if (commit.trailers.work === state.id && commit.trailers.task) continue;
    throw new Error(`Commit ${commit.hash.slice(0, 12)} "${commit.subject}" was not integrated from a task; the orchestrator must not implement in delegated execution`);
  }
}

export async function startSdd(cwd: string, id: string, profile: ApprovalProfile, execution: ExecutionMode = "inline"): Promise<WorkState> {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(id)) throw new Error("Work id must be a lowercase slug");
  if (await loadState(cwd)) throw new Error("Another mutating work is already active");
  const git = new GitRepository(cwd);
  await git.assertClean();
  const head = await git.head();
  const now = new Date().toISOString();
  const state: WorkState = {
    schemaVersion: 1,
    harnessVersion: HARNESS_VERSION,
    id,
    mode: "sdd",
    status: "active",
    profile,
    ...(execution === "delegated" ? { execution } : {}),
    phase: "intake",
    baseCommit: head,
    gateCommit: head,
    createdAt: now,
    updatedAt: now,
    tasks: [],
  };
  await createPhaseFile(cwd, state, "intake");
  await saveState(cwd, state);
  return state;
}

export async function advanceSdd(cwd: string, approved = false): Promise<string> {
  const state = await loadState(cwd);
  if (!state || state.mode !== "sdd" || !state.phase) throw new Error("No active SDD work");
  await assertSddConsistency(cwd, state);
  if (state.profile === "supervised" && HUMAN_GATES.has(state.phase) && !approved) {
    throw new Error(`Phase ${state.phase} requires explicit human approval`);
  }
  await assertPhaseFilled(cwd, state);
  if (state.phase === "implement" && state.tasks.some((task) => task.status !== "completed")) {
    throw new Error("Every declared task must be integrated before implementation can complete");
  }
  if (state.phase === "implement" && state.execution === "delegated") await assertDelegatedImplementation(cwd, state);
  if (state.phase === "review") await assertReviewPassed(cwd, state.id);
  if (state.phase === "validate" || state.phase === "close") {
    const checks = await runChecks(cwd);
    if (checks.issues.length > 0 || checks.testExitCode !== 0) throw new Error(`Checks failed during ${state.phase}`);
  }

  const git = new GitRepository(cwd);
  const previousHead = await git.head();
  const completed = state.phase;
  const index = SDD_PHASES.indexOf(completed);
  const next = SDD_PHASES[index + 1];

  if (!next) {
    for (const task of state.tasks) {
      if (task.worktree) {
        try {
          await git.run(["worktree", "remove", "--force", task.worktree]);
        } catch {
          // A missing worktree is already clean.
        }
      }
      if (task.branch) {
        try {
          await git.run(["branch", "-D", task.branch]);
        } catch {
          // A missing branch is already clean.
        }
      }
    }
    await rm(join(cwd, ".ways", "worktrees", state.id), { recursive: true, force: true });
    await rm(join(cwd, SDD_DIR, state.id), { recursive: true, force: true });
    await removeState(cwd);
  } else {
    state.lastCompletedPhase = completed;
    state.phase = next;
    state.gateCommit = previousHead;
    state.updatedAt = new Date().toISOString();
    await createPhaseFile(cwd, state, next);
    await saveState(cwd, state);
  }

  const paths = await git.changedPaths();
  return git.commit(paths, `sdd(${completed}): complete ${state.id}`, {
    work: state.id,
    phase: completed,
    state: "completed",
  });
}

export async function downgradeSdd(cwd: string, target: "quick" | "plan"): Promise<string> {
  const state = await loadState(cwd);
  if (!state || state.mode !== "sdd" || state.phase !== "assess") throw new Error("SDD can only downgrade during assess");
  await assertSddConsistency(cwd, state);
  await assertPhaseFilled(cwd, state);
  const git = new GitRepository(cwd);
  const previousHead = await git.head();
  await rm(join(cwd, SDD_DIR, state.id), { recursive: true, force: true });
  state.mode = target;
  state.gateCommit = previousHead;
  state.updatedAt = new Date().toISOString();
  delete state.phase;
  delete state.lastCompletedPhase;
  delete state.profile;
  if (target === "plan") {
    state.planPath = `${PLAN_DIR}/${state.id}.md`;
    await writeAtomic(join(cwd, state.planPath), `---\ntype: plan\nstatus: proposed\nwork: ${state.id}\n---\n\n# Goal\n\n# Plan\n\n1. \n`);
  }
  await saveState(cwd, state);
  return git.commit(await git.changedPaths(), `sdd(assess): downgrade ${state.id} to ${target}`, {
    work: state.id,
    phase: "assess",
    state: `downgraded-${target}`,
  });
}
