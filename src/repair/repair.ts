import { join } from "node:path";
import { SDD_PHASES, type SddPhase, type WorkState } from "../domain/types.js";
import { STATE_PATH } from "../domain/constants.js";
import { GitRepository } from "../git/git.js";
import { loadState, removeState, saveState } from "../state/store.js";
import { assertSddConsistency } from "../work/sdd.js";

export interface RepairDiagnosis {
  consistent: boolean;
  message: string;
  state?: WorkState;
}

export async function diagnose(cwd: string): Promise<RepairDiagnosis> {
  const state = await loadState(cwd);
  if (!state) return { consistent: true, message: "No active state" };
  if (state.mode !== "sdd") return { consistent: true, message: `Active ${state.mode} work has valid state`, state };
  try {
    await assertSddConsistency(cwd, state);
    return { consistent: true, message: "SDD state and Git are consistent", state };
  } catch (error) {
    return { consistent: false, message: error instanceof Error ? error.message : String(error), state };
  }
}

async function latestCertification(git: GitRepository, work: string) {
  return (await git.recentCommits()).find((commit) => commit.trailers.work === work && commit.trailers.state === "completed" && SDD_PHASES.includes(commit.trailers.phase as SddPhase));
}

export async function adoptHead(cwd: string): Promise<WorkState | undefined> {
  const state = await loadState(cwd);
  if (!state || state.mode !== "sdd") throw new Error("Adopt-head requires active SDD state");
  const git = new GitRepository(cwd);
  const certification = await latestCertification(git, state.id);
  if (!certification?.trailers.phase) throw new Error("No SDD certification found in HEAD history");
  const completed = certification.trailers.phase as SddPhase;
  const next = SDD_PHASES[SDD_PHASES.indexOf(completed) + 1];
  if (!next) {
    await removeState(cwd);
    return undefined;
  }
  state.lastCompletedPhase = completed;
  state.phase = next;
  state.gateCommit = await git.parent(certification.hash);
  state.updatedAt = new Date().toISOString();
  await saveState(cwd, state);
  return state;
}

export async function restoreStateFromHead(cwd: string): Promise<WorkState | undefined> {
  const git = new GitRepository(cwd);
  try {
    const content = await git.run(["show", `HEAD:${STATE_PATH}`]);
    const path = join(cwd, STATE_PATH);
    const { writeAtomic } = await import("../fs/files.js");
    await writeAtomic(path, `${content}\n`);
    return loadState(cwd);
  } catch {
    await removeState(cwd);
    return undefined;
  }
}

export async function rollbackToLastGate(cwd: string, discard: boolean): Promise<string> {
  if (!discard) throw new Error("Rollback requires explicit --discard");
  const state = await loadState(cwd);
  if (!state || state.mode !== "sdd") throw new Error("Rollback requires active SDD state");
  const git = new GitRepository(cwd);
  const certification = await latestCertification(git, state.id);
  if (!certification) throw new Error("No completed gate found");
  await git.run(["reset", "--hard", certification.hash]);
  await git.run(["clean", "-fd", "--", `.ways/sdd/${state.id}`]);
  await restoreStateFromHead(cwd);
  return certification.hash;
}
