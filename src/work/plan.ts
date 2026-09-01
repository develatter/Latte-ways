import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { HARNESS_VERSION } from "../index.js";
import { PLAN_DIR } from "../domain/constants.js";
import type { WorkState } from "../domain/types.js";
import { runChecks } from "../check/check.js";
import { writeAtomic } from "../fs/files.js";
import { GitRepository } from "../git/git.js";
import { loadState, removeState, saveState } from "../state/store.js";

function planTemplate(id: string): string {
  return `---\ntype: plan\nstatus: proposed\nwork: ${id}\n---\n\n# Goal\n\n# Plan\n\n1. \n\n# Acceptance\n`;
}

export async function startPlan(cwd: string, id: string): Promise<WorkState> {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(id)) throw new Error("Work id must be a lowercase slug");
  if (await loadState(cwd)) throw new Error("Another mutating work is already active");
  const git = new GitRepository(cwd);
  await git.assertClean();
  const head = await git.head();
  const now = new Date().toISOString();
  const planPath = `${PLAN_DIR}/${id}.md`;
  const state: WorkState = {
    schemaVersion: 1,
    harnessVersion: HARNESS_VERSION,
    id,
    mode: "plan",
    status: "active",
    baseCommit: head,
    gateCommit: head,
    createdAt: now,
    updatedAt: now,
    planPath,
    tasks: [],
  };
  await mkdir(join(cwd, PLAN_DIR), { recursive: true });
  await writeAtomic(join(cwd, planPath), planTemplate(id));
  await saveState(cwd, state);
  return state;
}

export async function proposePlan(cwd: string): Promise<string> {
  const state = await loadState(cwd);
  if (!state || state.mode !== "plan" || !state.planPath) throw new Error("No active plan");
  const content = await readFile(join(cwd, state.planPath), "utf8");
  if (/^1\.\s*$/m.test(content)) throw new Error("Plan still contains an empty first step");
  const git = new GitRepository(cwd);
  return git.commit(await git.changedPaths(), `plan: propose ${state.id}`, {
    work: state.id,
    phase: "plan",
    state: "proposed",
  });
}

export async function finishPlan(cwd: string, subject: string, memory: "updated" | "unchanged"): Promise<string> {
  const state = await loadState(cwd);
  if (!state || state.mode !== "plan" || !state.planPath) throw new Error("No active plan");
  if (!subject.trim()) throw new Error("A concise commit message is required");
  if (memory !== "updated" && memory !== "unchanged") throw new Error("Memory disposition must be updated or unchanged");
  const checks = await runChecks(cwd);
  if (checks.issues.length > 0 || checks.testExitCode !== 0) throw new Error("Checks failed; plan cannot close");
  await rm(join(cwd, state.planPath), { force: true });
  await removeState(cwd);
  const git = new GitRepository(cwd);
  return git.commit(await git.changedPaths(), subject, { work: state.id, state: "completed" });
}

export async function abandonPlan(cwd: string): Promise<string> {
  const state = await loadState(cwd);
  if (!state || state.mode !== "plan" || !state.planPath) throw new Error("No active plan");
  await rm(join(cwd, state.planPath), { force: true });
  await removeState(cwd);
  const git = new GitRepository(cwd);
  return git.commit(await git.changedPaths(), `plan: abandon ${state.id}`, { work: state.id, state: "cancelled" });
}
