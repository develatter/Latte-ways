import { readFile } from "node:fs/promises";
import { MANIFEST_PATH, STATE_PATH } from "../domain/constants.js";
import type { WorkState } from "../domain/types.js";
import { validateState } from "../domain/validation.js";
import { GitRepository, parseTrailers } from "../git/git.js";
import { loadState } from "../state/store.js";
import { approvalBinds, approvalPath, requiresApproval } from "../work/approve.js";
import { committedMismatch } from "../work/sdd.js";
import { validateApproval } from "../domain/validation.js";

export interface HookVerdict {
  accepted: boolean;
  reason: string;
}

const CLOSING_STATES = new Set(["completed", "cancelled"]);

async function headState(git: GitRepository): Promise<WorkState | undefined> {
  try {
    const value: unknown = JSON.parse(await git.run(["show", `HEAD:${STATE_PATH}`]));
    return validateState(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

async function stagesStateDeletion(git: GitRepository): Promise<boolean> {
  const output = await git.run(["diff", "--cached", "--name-only", "--diff-filter=D", "--", STATE_PATH]);
  return output.split("\n").includes(STATE_PATH);
}

/** A certification of a supervised human gate must carry a matching approval artifact in the same commit. */
async function stagedApprovalFailure(git: GitRepository, work: WorkState, committed: WorkState | undefined, phase: string): Promise<string | undefined> {
  const path = approvalPath(work.id, phase);
  let value: unknown;
  try {
    value = JSON.parse(await git.run(["show", `:${path}`]));
  } catch {
    return `certification of human gate ${phase} must stage a human approval at ${path}`;
  }
  if (!validateApproval(value)) return `staged approval at ${path} is invalid`;
  // The approval was written against the gate recorded by the state committed at HEAD.
  return approvalBinds(value, { workId: work.id, phase, gateCommit: committed?.gateCommit ?? await git.head() });
}

/** The close gate removes the SDD folder, so its approval must be present at HEAD's working tree and staged for deletion. */
async function deletedApprovalFailure(git: GitRepository, work: WorkState): Promise<string | undefined> {
  const path = approvalPath(work.id, "close");
  const deleted = (await git.run(["diff", "--cached", "--name-only", "--diff-filter=D", "--", path])).split("\n").includes(path);
  if (!deleted) return `closing commit must stage the deletion of a committed approval at ${path}`;
  let value: unknown;
  try {
    value = JSON.parse(await git.run(["show", `HEAD:${path}`]));
  } catch {
    return `approval at ${path} is not committed at HEAD`;
  }
  if (!validateApproval(value)) return `approval at ${path} is invalid`;
  return approvalBinds(value, { workId: work.id, phase: "close", gateCommit: work.gateCommit });
}

async function headHasManifest(git: GitRepository): Promise<boolean> {
  try {
    await git.run(["cat-file", "-e", `HEAD:${MANIFEST_PATH}`]);
    return true;
  } catch {
    return false;
  }
}

export async function judgeCommitMessage(cwd: string, message: string): Promise<HookVerdict> {
  const trailers = parseTrailers(message);
  const git = new GitRepository(cwd);

  const active = await loadState(cwd);
  if (active) {
    if (trailers.work === active.id) {
      const committed = await headState(git);
      const opening = trailers.state === "opened" && !committed;
      const mismatch = opening ? undefined : committedMismatch(committed, active);
      if (mismatch) return { accepted: false, reason: `${mismatch}; run ways repair` };
      const certified = active.lastCompletedPhase;
      const certifying = trailers.state === "completed" && certified !== undefined && trailers.phase === certified;
      if (certifying && requiresApproval({ ...active, phase: certified })) {
        const failure = await stagedApprovalFailure(git, active, committed, trailers.phase!);
        if (failure) return { accepted: false, reason: `Human gate ${trailers.phase} of ${active.id}: ${failure}` };
      }
      return { accepted: true, reason: `Commit traced to active ${active.mode} work ${active.id}` };
    }
    return { accepted: false, reason: `Active ${active.mode} work is ${active.id}; commit through the harness so it carries Harness-Work: ${active.id}` };
  }

  const closing = await headState(git);
  if (closing) {
    const traced = trailers.work === closing.id && trailers.state !== undefined && CLOSING_STATES.has(trailers.state);
    const phased = closing.mode !== "sdd" || trailers.state === "cancelled" || trailers.phase === "close";
    if (traced && phased && await stagesStateDeletion(git)) {
      if (trailers.phase === "close" && requiresApproval({ ...closing, phase: "close" })) {
        const failure = await deletedApprovalFailure(git, closing);
        if (failure) return { accepted: false, reason: `Human gate close of ${closing.id}: ${failure}` };
      }
      return { accepted: true, reason: `Closing commit for ${closing.id}` };
    }
    return { accepted: false, reason: `HEAD still records work ${closing.id}; only its closing commit, deleting ${STATE_PATH}, may follow. Run ways repair diagnose` };
  }

  if (!await headHasManifest(git)) return { accepted: true, reason: "Bootstrap commit accepted" };
  return { accepted: false, reason: "No active work. Open one first, for example: ways quick start <id>" };
}

export async function runCommitMsgHook(cwd: string, messagePath: string): Promise<HookVerdict> {
  const raw = await readFile(messagePath, "utf8");
  const message = raw.split("\n").filter((line) => !line.startsWith("#")).join("\n");
  return judgeCommitMessage(cwd, message);
}
