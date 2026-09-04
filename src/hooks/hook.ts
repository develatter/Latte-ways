import { readFile } from "node:fs/promises";
import { MANIFEST_PATH, STATE_PATH } from "../domain/constants.js";
import type { RemediationRecord, WorkState } from "../domain/types.js";
import { validateApproval, validateRemediation, validateState } from "../domain/validation.js";
import { GitRepository, parseTrailers } from "../git/git.js";
import { loadState } from "../state/store.js";
import { approvalBinds, approvalPath, requiresApproval } from "../work/approve.js";
import { attemptNumber, attemptPhasePath, attemptReviewPath, isPriorAttemptArtifact, remediationRecordPath } from "../work/attempt.js";
import { remediationEvidenceFailure } from "../work/remediation.js";
import { committedMismatch } from "../work/sdd.js";

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
  const path = approvalPath(work.id, phase, work.attempt);
  let value: unknown;
  try {
    value = JSON.parse(await git.run(["show", `:${path}`]));
  } catch {
    return `certification of human gate ${phase} must stage a human approval at ${path}`;
  }
  if (!validateApproval(value)) return `staged approval at ${path} is invalid`;
  // The approval was written against the gate recorded by the state committed at HEAD.
  return approvalBinds(value, { workId: work.id, phase, gateCommit: committed?.gateCommit ?? await git.head(), attempt: work.attempt });
}

/** The close gate removes the SDD folder, so its approval must be present at HEAD's working tree and staged for deletion. */
async function deletedApprovalFailure(git: GitRepository, work: WorkState): Promise<string | undefined> {
  const path = approvalPath(work.id, "close", work.attempt);
  const deleted = (await git.run(["diff", "--cached", "--name-only", "--diff-filter=D", "--", path])).split("\n").includes(path);
  if (!deleted) return `closing commit must stage the deletion of a committed approval at ${path}`;
  let value: unknown;
  try {
    value = JSON.parse(await git.run(["show", `HEAD:${path}`]));
  } catch {
    return `approval at ${path} is not committed at HEAD`;
  }
  if (!validateApproval(value)) return `approval at ${path} is invalid`;
  return approvalBinds(value, { workId: work.id, phase: "close", gateCommit: work.gateCommit, attempt: work.attempt });
}

function trailerAttemptMatches(value: string | undefined, attempt: number | undefined): boolean {
  const expected = attemptNumber(attempt);
  return expected === 0 ? value === undefined || value === "0" : value === String(expected);
}

async function stagedRemediationFailure(git: GitRepository, active: WorkState, committed: WorkState | undefined): Promise<string | undefined> {
  const remediation = active.remediation;
  const attempt = attemptNumber(active.attempt);
  if (!committed || committed.mode !== "sdd" || !remediation || attempt === 0 || remediation.attempt !== attempt) {
    return "remediation state is incomplete";
  }
  if ((committed.phase !== "review" && committed.phase !== "validate") || remediation.source !== committed.phase
    || active.phase !== remediation.target || attempt !== attemptNumber(committed.attempt) + 1
    || remediation.priorCheckpoint !== await git.head() || active.gateCommit !== remediation.priorCheckpoint) {
    return "remediation state does not form the next legal transition";
  }
  const path = remediationRecordPath(active.id, attempt);
  const added = (await git.run(["diff", "--cached", "--name-only", "--diff-filter=A", "--", path])).split("\n").includes(path);
  let record: RemediationRecord | undefined;
  try {
    const value: unknown = JSON.parse(await git.run(["show", `:${path}`]));
    if (validateRemediation(value)) record = value;
  } catch {
    // Report a stable failure below.
  }
  if (!added || !record || record.workId !== active.id || record.source !== remediation.source || record.target !== remediation.target
    || record.attempt !== attempt || record.priorCheckpoint !== remediation.priorCheckpoint
    || JSON.stringify(record.evidence) !== JSON.stringify(remediation.evidence)
    || record.reason !== remediation.reason || record.timestamp !== remediation.timestamp) {
    return `must stage matching remediation evidence at ${path}`;
  }
  const tree = await git.run(["write-tree"]);
  return remediationEvidenceFailure(git, record, await git.head(), tree);
}

async function stagedPriorArtifactFailure(git: GitRepository, active: WorkState, allowed: ReadonlySet<string> = new Set()): Promise<string | undefined> {
  const attempt = attemptNumber(active.attempt);
  if (attempt === 0) return undefined;
  const changed = (await git.run(["diff", "--cached", "--name-only", "HEAD"])).split("\n").filter(Boolean);
  const protectedPath = changed.find((path) => !allowed.has(path) && isPriorAttemptArtifact(path, active.id, attempt));
  return protectedPath ? `prior SDD artifact is immutable: ${protectedPath}` : undefined;
}

function remediationTransitionArtifacts(active: WorkState): Set<string> {
  const remediation = active.remediation!;
  const sourceAttempt = attemptNumber(active.attempt) - 1;
  const allowed = new Set([
    remediationRecordPath(active.id, attemptNumber(active.attempt)),
    attemptPhasePath(active.id, sourceAttempt, remediation.source),
  ]);
  if (remediation.source === "review") allowed.add(attemptReviewPath(active.id, sourceAttempt));
  return allowed;
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
      if (!trailerAttemptMatches(trailers.attempt, active.attempt)) {
        return { accepted: false, reason: `Commit attempt does not match active remediation attempt ${attemptNumber(active.attempt)}` };
      }
      if (trailers.state?.startsWith("remediated")) {
        const remediation = active.remediation;
        if (!trailers.state.startsWith("remediated-") || !remediation || trailers.phase !== remediation.source || trailers.state !== `remediated-${remediation.target}`) {
          return { accepted: false, reason: "Remediation trailers do not match active remediation state" };
        }
        const failure = await stagedRemediationFailure(git, active, committed);
        if (failure) return { accepted: false, reason: `Remediation of ${active.id}: ${failure}` };
        const immutable = await stagedPriorArtifactFailure(git, active, remediationTransitionArtifacts(active));
        if (immutable) return { accepted: false, reason: immutable };
      } else {
        const failure = await stagedPriorArtifactFailure(git, active);
        if (failure) return { accepted: false, reason: failure };
      }
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
    if (traced && phased && trailerAttemptMatches(trailers.attempt, closing.attempt) && await stagesStateDeletion(git)) {
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
