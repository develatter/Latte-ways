import { readFile } from "node:fs/promises";
import { MANIFEST_PATH, STATE_PATH } from "../domain/constants.js";
import { recordVersion, type LifecycleContract } from "../domain/lifecycle.js";
import type { RemediationRecord, WorkState } from "../domain/types.js";
import { validateApproval, validateRemediation, validateState, validateValidationFailure, validationDetails } from "../domain/validation.js";
import { GitRepository, parseTrailers } from "../git/git.js";
import { loadState } from "../state/store.js";
import { approvalBinds, approvalPath, requiresApproval } from "../work/approve.js";
import { attemptPhasePath, attemptReviewPath, isPriorAttemptArtifact, remediationRecordPath, validationFailureRecordPath } from "../work/attempt.js";
import { remediationEvidenceFailure } from "../work/remediation.js";
import { validationFailureRecordFailure, validationFailureReplayFailure } from "../work/validation-failure.js";
import { committedMismatch } from "../work/sdd.js";
export interface HookVerdict {
  accepted: boolean;
  reason: string;
}

const CLOSING_STATES = new Set(["completed", "cancelled"]);

async function headState(git: GitRepository): Promise<WorkState | undefined> {
  let value: unknown;
  try {
    value = JSON.parse(await git.run(["show", `HEAD:${STATE_PATH}`]));
  } catch {
    return undefined;
  }
  if (!validateState(value)) throw new Error(`Committed state is invalid: ${validationDetails("state", value).errors.join("; ")}`);
  return value;
}

async function stagesStateDeletion(git: GitRepository): Promise<boolean> {
  const output = await git.run(["diff", "--cached", "--name-only", "--diff-filter=D", "--", STATE_PATH]);
  return output.split("\n").includes(STATE_PATH);
}
async function stagedApprovalFailure(
  git: GitRepository,
  work: WorkState,
  committed: WorkState | undefined,
  phase: string,
  contract: LifecycleContract,
): Promise<string | undefined> {
  const path = approvalPath(work.id, phase, work.attempt);
  let value: unknown;
  try {
    value = JSON.parse(await git.run(["show", `:${path}`]));
  } catch {
    return `certification of human gate ${phase} must stage a human approval at ${path}`;
  }
  const details = validationDetails("approval", value);
  if (!validateApproval(value)) return `staged approval at ${path} is invalid: ${details.errors.join("; ")}`;
  return approvalBinds(value, {
    workId: work.id,
    phase,
    gateCommit: committed?.gateCommit ?? await git.head(),
    attempt: work.attempt,
    contract,
  });
}
async function deletedApprovalFailure(git: GitRepository, work: WorkState): Promise<string | undefined> {
  const contract = recordVersion(work, "SDD state");
  const path = approvalPath(work.id, contract.phases.at(-1)!, work.attempt);
  const deleted = (await git.run(["diff", "--cached", "--name-only", "--diff-filter=D", "--", path])).split("\n").includes(path);
  if (!deleted) return `closing commit must stage the deletion of a committed approval at ${path}`;
  let value: unknown;
  try {
    value = JSON.parse(await git.run(["show", `HEAD:${path}`]));
  } catch {
    return `approval at ${path} is not committed at HEAD`;
  }
  const details = validationDetails("approval", value);
  if (!validateApproval(value)) return `approval at ${path} is invalid: ${details.errors.join("; ")}`;
  return approvalBinds(value, { workId: work.id, phase: contract.phases.at(-1)!, gateCommit: work.gateCommit, attempt: work.attempt, contract });
}
function trailerAttemptMatches(value: string | undefined, attempt: number, contract: LifecycleContract): boolean {
  return contract.attemptTrailerMatches(value, attempt);
}

async function stagedRemediationFailure(git: GitRepository, active: WorkState, committed: WorkState | undefined): Promise<string | undefined> {
  const contract = recordVersion(active, "SDD state");
  const remediation = active.remediation;
  const attempt = contract.attemptNumber(active.attempt);
  if (!committed || committed.mode !== "sdd" || !remediation || attempt === 0 || remediation.attempt !== attempt) {
    return "remediation state is incomplete";
  }
  let transitionFailure: string | undefined;
  try {
    transitionFailure = contract.remediationFailure({
      workId: active.id,
      sourcePhase: remediation.source,
      currentPhase: committed.phase,
      target: remediation.target,
      attempt,
      expectedAttempt: contract.attemptNumber(committed.attempt),
    });
  } catch (error) {
    transitionFailure = error instanceof Error ? error.message : String(error);
  }
  if (transitionFailure || active.phase !== remediation.target
    || remediation.priorCheckpoint !== await git.head() || active.gateCommit !== remediation.priorCheckpoint) {
    return transitionFailure ?? "remediation state does not form the next legal transition";
  }
  const path = remediationRecordPath(active.id, attempt);
  const added = (await git.run(["diff", "--cached", "--name-only", "--diff-filter=A", "--", path])).split("\n").includes(path);
  let record: RemediationRecord | undefined;
  let diagnostic: string | undefined;
  try {
    const value: unknown = JSON.parse(await git.run(["show", `:${path}`]));
    const details = validationDetails("remediation", value);
    if (!details.valid) diagnostic = `staged remediation at ${path} is invalid: ${details.errors.join("; ")}`;
    else if (validateRemediation(value)) record = value;
  } catch (error) {
    diagnostic = error instanceof Error ? error.message : String(error);
  }
  if (!added || !record || record.workId !== active.id || record.source !== remediation.source || record.target !== remediation.target
    || record.attempt !== attempt || record.priorCheckpoint !== remediation.priorCheckpoint
    || JSON.stringify(record.evidence) !== JSON.stringify(remediation.evidence)
    || record.reason !== remediation.reason || record.timestamp !== remediation.timestamp) {
    return diagnostic ?? `must stage matching remediation evidence at ${path}`;
  }
  const tree = await git.run(["write-tree"]);
  return remediationEvidenceFailure(git, record, await git.head(), tree);
}

async function stagedPriorArtifactFailure(
  git: GitRepository,
  active: WorkState,
  contract: LifecycleContract,
  allowed: ReadonlySet<string> = new Set(),
): Promise<string | undefined> {
  const attempt = contract.attemptNumber(active.attempt);
  if (attempt === 0) return undefined;
  const changed = (await git.run(["diff", "--cached", "--name-only", "HEAD"])).split("\n").filter(Boolean);
  const protectedPath = changed.find((path) => !allowed.has(path) && isPriorAttemptArtifact(path, active.id, attempt));
  return protectedPath ? `prior SDD artifact is immutable: ${protectedPath}` : undefined;
}

function remediationTransitionArtifacts(active: WorkState, contract: LifecycleContract): Set<string> {
  const remediation = active.remediation!;
  const attempt = contract.attemptNumber(active.attempt);
  const sourceAttempt = attempt - 1;
  const allowed = new Set([remediationRecordPath(active.id, attempt)]);
  // Legacy review remediation captures its submitted review and phase context in the transition.
  if (remediation.source === "review") {
    allowed.add(attemptPhasePath(active.id, sourceAttempt, contract.reviewPhase));
    allowed.add(attemptReviewPath(active.id, sourceAttempt));
  }
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
    const contract = recordVersion(active, "SDD state");
    if (trailers.work === active.id) {
      const committed = await headState(git);
      const opening = trailers.state === "opened" && !committed;
      const mismatch = opening ? undefined : committedMismatch(committed, active);
      if (mismatch) return { accepted: false, reason: `${mismatch}; run ways repair` };
      const attempt = contract.attemptNumber(active.attempt);
      if (!trailerAttemptMatches(trailers.attempt, attempt, contract)) {
        return { accepted: false, reason: `Commit attempt does not match active remediation attempt ${attempt}` };
      }
      if (trailers.state === "validation-failed") {
        if (trailers.phase !== contract.validationPhase || active.phase !== contract.validationPhase) {
          return { accepted: false, reason: `Validation failure trailers do not match the active ${contract.validationPhase} phase` };
        }
        const path = validationFailureRecordPath(active.id, attempt);
        const changed = (await git.run(["diff", "--cached", "--name-only", "HEAD"])).split("\n").filter(Boolean);
        if (changed.length !== 1 || changed[0] !== path) {
          return { accepted: false, reason: `Validation failure must stage only ${path}` };
        }
        try {
          const value: unknown = JSON.parse(await git.run(["show", `:${path}`]));
          if (!validateValidationFailure(value)) {
            return { accepted: false, reason: `Validation failure record is invalid: ${validationDetails("validation-failure", value).errors.join("; ")}` };
          }
          const invalid = validationFailureRecordFailure(value);
          if (invalid || value.workId !== active.id || value.attempt !== attempt || value.inputCommit !== await git.head()
            || value.inputTree !== await git.run(["rev-parse", "HEAD^{tree}"])) {
            return { accepted: false, reason: invalid ?? "Validation failure record does not bind the current committed input" };
          }
          const replayFailure = await validationFailureReplayFailure(git, value);
          if (replayFailure) return { accepted: false, reason: replayFailure };
        } catch (error) {
          return { accepted: false, reason: error instanceof Error ? error.message : "Validation failure record is unreadable" };
        }
      } else if (trailers.state?.startsWith("remediated")) {
        const remediation = active.remediation;
        if (!trailers.state.startsWith("remediated-") || !remediation || trailers.phase !== remediation.source
          || trailers.state !== `remediated-${remediation.target}`) {
          return { accepted: false, reason: "Remediation trailers do not match active remediation state" };
        }
        const failure = await stagedRemediationFailure(git, active, committed);
        if (failure) return { accepted: false, reason: `Remediation of ${active.id}: ${failure}` };
        const immutable = await stagedPriorArtifactFailure(git, active, contract, remediationTransitionArtifacts(active, contract));
        if (immutable) return { accepted: false, reason: immutable };
      } else {
        const failure = await stagedPriorArtifactFailure(git, active, contract);
        if (failure) return { accepted: false, reason: failure };
      }
      const certified = active.lastCompletedPhase;
      const certifying = trailers.state === "completed" && certified !== undefined && trailers.phase === certified;
      if (certifying) {
        let failure: string | undefined;
        try {
          failure = contract.certificationFailure({
            workId: active.id,
            completedPhase: trailers.phase,
            expectedPhase: certified,
            attempt,
            expectedAttempt: contract.attemptNumber(active.attempt),
          });
        } catch (error) {
          failure = error instanceof Error ? error.message : String(error);
        }
        if (failure) return { accepted: false, reason: failure };
        if (requiresApproval({ ...active, phase: certified })) {
          const approvalFailure = await stagedApprovalFailure(git, active, committed, certified, contract);
          if (approvalFailure) return { accepted: false, reason: `Human gate ${certified} of ${active.id}: ${approvalFailure}` };
        }
      }
      return { accepted: true, reason: `Commit traced to active ${active.mode} work ${active.id}` };
    }
    return { accepted: false, reason: `Active ${active.mode} work is ${active.id}; commit through the harness so it carries Harness-Work: ${active.id}` };
  }

  const closing = await headState(git);
  if (closing) {
    const contract = recordVersion(closing, "closing SDD state");
    const closePhase = contract.phases[contract.phases.length - 1]!;
    const traced = trailers.work === closing.id && trailers.state !== undefined && CLOSING_STATES.has(trailers.state);
    const phased = closing.mode !== "sdd" || trailers.state === "cancelled" || trailers.phase === closePhase;
    if (traced && phased && trailerAttemptMatches(trailers.attempt, contract.attemptNumber(closing.attempt), contract) && await stagesStateDeletion(git)) {
      if (trailers.phase === closePhase && requiresApproval({ ...closing, phase: closePhase })) {
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
