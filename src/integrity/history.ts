import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { MANIFEST_PATH, STATE_PATH } from "../domain/constants.js";
import { LifecycleContractError, lifecycleContract, recordVersion, type LifecycleContract } from "../domain/lifecycle.js";
import type { RemediationRecord, RemediationTarget, SddPhase } from "../domain/types.js";
import { validateRemediation, validationDetails, validateState } from "../domain/validation.js";
import { loadConfig } from "../config/config.js";
import { GitRepository, type CommitInfo } from "../git/git.js";
import { attemptPhasePath, attemptReviewPath, isPriorAttemptArtifact, remediationRecordPath } from "../work/attempt.js";
import { remediationEvidenceFailure } from "../work/remediation.js";
import { committedValidationFailureFailure } from "../work/validation-failure.js";
import type { IntegrityIssue } from "./integrity.js";

export interface HistoryOptions {
  since?: string;
  to?: string;
}

export interface HistoryCheckpoint {
  work: string;
  attempt: number;
  kind: "certification" | "remediation";
  commit: CommitInfo;
  phase: SddPhase;
  target?: RemediationTarget;
}


export async function manifestIntroduction(git: GitRepository): Promise<string | undefined> {
  const output = await git.run(["log", "--format=%H", "--diff-filter=A", "--", MANIFEST_PATH]);
  const hashes = output.split("\n").filter(Boolean);
  return hashes[hashes.length - 1];
}

async function resolveAnchor(cwd: string, git: GitRepository, since?: string): Promise<string | undefined> {
  if (since) return git.run(["rev-parse", "--verify", `${since}^{commit}`]);
  try {
    const config = await loadConfig(cwd);
    if (config.historySince) return git.run(["rev-parse", "--verify", `${config.historySince}^{commit}`]);
  } catch {
    // Missing config is reported by checkIntegrity.
  }
  return manifestIntroduction(git);
}

export async function commitsAfter(git: GitRepository, anchor: string, to = "HEAD"): Promise<CommitInfo[]> {
  const output = await git.run(["rev-list", "--topo-order", "--reverse", `${anchor}..${to}`]);
  const commits: CommitInfo[] = [];
  for (const hash of output.split("\n").filter(Boolean)) commits.push(await git.commitInfo(hash));
  return commits;
}

interface ReplayState {
  attempt: number;
  nextPhase: SddPhase;
  validationFailed: boolean;
}

function issue(issues: IntegrityIssue[], commit: CommitInfo, code: string, message: string): void {
  issues.push({ code, path: commit.hash.slice(0, 12), message });
}

function parsedAttempt(value: string | undefined, contract: LifecycleContract): number | undefined {
  try {
    return contract.attemptNumber(value, "history trailer");
  } catch {
    return undefined;
  }
}
/** Replay ordered SDD history using the resolved contract, never local phase lists. */
export function replayCommits(
  commits: readonly CommitInfo[],
  activeId?: string,
  schemaVersion: unknown = 1,
  transportOnlyMerges: ReadonlySet<string> = new Set(),
): { issues: IntegrityIssue[]; checkpoints: HistoryCheckpoint[] } {
  const contract = lifecycleContract(schemaVersion, "history contract");
  const issues: IntegrityIssue[] = [];
  const checkpoints: HistoryCheckpoint[] = [];
  const replay = new Map<string, ReplayState>();
  const opened = new Map<string, string>();

  for (const commit of commits) {
    const { work, phase, state } = commit.trailers;
    // Harness-Work alone traces a commit: inline implementation and semantic-memory
    // commits are not SDD transitions, so they carry no state or task.
    if (!work) {
      if (transportOnlyMerges.has(commit.hash)) continue;
      issue(issues, commit, "history-untraced", `Commit "${commit.subject}" lacks a Harness-Work trailer`);
      continue;
    }
    if (state === "opened") opened.set(work, commit.hash.slice(0, 12));
    else if (state === "completed" || state === "cancelled") opened.delete(work);

    const current = replay.get(work) ?? { attempt: 0, nextPhase: contract.phases[0], validationFailed: false };
    const commitAttempt = parsedAttempt(commit.trailers.attempt, contract);
    if (commit.trailers.task && commitAttempt !== current.attempt) {
      issue(issues, commit, "history-attempt-mismatch", `Task commit for ${work} does not belong to remediation attempt ${current.attempt}`);
      continue;
    }
    if (state === "approved") {
      if (!contract.isPhase(phase) || phase !== current.nextPhase || commitAttempt !== current.attempt) {
        issue(issues, commit, "history-attempt-mismatch", `Approval commit for ${work} does not belong to the current phase and remediation attempt`);
      }
      continue;
    }
    if (state === "validation-failed") {
      if (!contract.isPhase(phase) || phase !== contract.validationPhase || commitAttempt === undefined
        || commitAttempt !== current.attempt || current.nextPhase !== contract.validationPhase || current.validationFailed) {
        issue(issues, commit, "history-invalid-validation-failure", `Validation failure record for ${work} is not in ${contract.validationPhase} of attempt ${current.attempt}`);
      } else {
        replay.set(work, { ...current, validationFailed: true });
      }
      continue;
    }
    const remediationMatch = state?.match(/^remediated-(.+)$/);
    if (state?.startsWith("remediated") && !remediationMatch) {
      issue(issues, commit, "history-invalid-remediation", `Remediation transition for ${work} has a malformed Harness-State trailer`);
      continue;
    }
    if (remediationMatch) {
      const targetText = remediationMatch[1];
      const target = contract.isRemediationTarget(targetText) ? targetText : undefined;
      let failure: string | undefined;
      if (!contract.isPhase(phase) || commitAttempt === undefined || target === undefined) {
        failure = `Remediation transition for ${work} is not a legal ${current.nextPhase} attempt ${current.attempt + 1} transition`;
      } else {
        try {
          failure = contract.remediationFailure({
            workId: work,
            sourcePhase: phase,
            currentPhase: current.nextPhase,
            target,
            attempt: commitAttempt,
            expectedAttempt: current.attempt,
          });
        } catch (error) {
          failure = error instanceof Error ? error.message : String(error);
        }
      }
      if (failure) {
        issue(issues, commit, "history-invalid-remediation", failure);
        continue;
      }
      replay.set(work, { attempt: commitAttempt as number, nextPhase: target as RemediationTarget, validationFailed: false });
      checkpoints.push({
        work,
        attempt: commitAttempt as number,
        kind: "remediation",
        commit,
        phase: phase as SddPhase,
        target: target as RemediationTarget,
      });
      continue;
    }
    if (state !== "completed") continue;
    // Quick/plan completion commits carry Harness-State but no SDD phase.
    // They are traced history, not lifecycle certifications.
    if (phase === undefined) continue;
    if (!contract.isPhase(phase)) {
      issue(issues, commit, "history-broken-chain", `Certification of ${String(phase)} for ${work} uses an unrecognized SDD phase`);
      continue;
    }
    const completed = phase;
    let failure: string | undefined;
    if (commitAttempt === undefined) {
      failure = `Certification of ${completed} for ${work} has an invalid attempt trailer`;
    } else {
      try {
        failure = contract.certificationFailure({
          workId: work,
          completedPhase: completed,
          expectedPhase: current.nextPhase,
          attempt: commitAttempt,
          expectedAttempt: current.attempt,
          validationFailed: current.validationFailed,
        });
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
    }
    if (failure) {
      issue(issues, commit, "history-broken-chain", failure);
      continue;
    }
    const next = contract.nextPhase(completed);
    if (next) replay.set(work, { attempt: current.attempt, nextPhase: next, validationFailed: false });
    else replay.delete(work);
    checkpoints.push({ work, attempt: commitAttempt!, kind: "certification", commit, phase: completed });
  }

  for (const [work, path] of opened) {
    if (work !== activeId) issues.push({ code: "history-abandoned-opening", path, message: `Supervised work ${work} was opened but never certified or closed` });
  }
  return { issues, checkpoints };
}
export function auditCommits(commits: readonly CommitInfo[], activeId?: string, schemaVersion: unknown = 1): IntegrityIssue[] {
  return replayCommits(commits, activeId, schemaVersion).issues;
}

async function transportOnlyMergeHashes(
  git: GitRepository,
  commits: readonly CommitInfo[],
  contract: LifecycleContract,
): Promise<Set<string>> {
  const safe = new Set<string>();
  for (const commit of commits) {
    if (commit.trailers.work) continue;
    try {
      const parents = await git.parents(commit.hash);
      if (parents.length !== 2) continue;
      const [base, branch] = parents;
      if (!base || !branch) continue;
      if (await git.treeId(commit.hash) !== await git.mergedTree(base, branch)) continue;
      const introduced = await commitsAfter(git, base, branch);
      if (replayCommits(introduced, undefined, contract.schemaVersion).issues.length === 0) safe.add(commit.hash);
    } catch {
      // A merge whose topology or expected tree cannot be proven remains untraced.
    }
  }
  return safe;
}


/**
 * v1 remediation commits used Harness-State: remediated and put source/target
 * only in their committed record.  Hydrate that record before ordered replay;
 * new commits are deliberately required to carry the explicit trailers.
 */
async function hydrateLegacyRemediations(
  git: GitRepository,
  commits: readonly CommitInfo[],
  contract: LifecycleContract,
): Promise<CommitInfo[]> {
  return Promise.all(commits.map(async (commit) => {
    if (commit.trailers.state !== "remediated" || !commit.trailers.work) return commit;
    const attempt = parsedAttempt(commit.trailers.attempt, contract);
    if (attempt === undefined || attempt === 0) return commit;
    try {
      const path = remediationRecordPath(commit.trailers.work, attempt);
      const value: unknown = JSON.parse(await git.run(["show", `${commit.hash}:${path}`]));
      const details = validationDetails("remediation", value);
      if (!details.valid) {
        const unsupported = details.errors.find((error) => error.includes("unsupported lifecycle contract version"));
        if (unsupported) {
          recordVersion(value, `legacy remediation record at ${path}`);
          throw new LifecycleContractError("lifecycle-unsupported-version", unsupported);
        }
        return commit;
      }
      if (!validateRemediation(value)) return commit;
      if (value.workId !== commit.trailers.work || value.attempt !== attempt) return commit;
      return {
        ...commit,
        trailers: { ...commit.trailers, phase: value.source, state: `remediated-${value.target}` },
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("unsupported lifecycle contract version")) throw error;
      return commit;
    }
  }));
}

async function remediationEvidenceIssues(git: GitRepository, checkpoints: readonly HistoryCheckpoint[]): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];
  for (const checkpoint of checkpoints) {
    if (checkpoint.kind !== "remediation" || !checkpoint.target) continue;
    const path = remediationRecordPath(checkpoint.work, checkpoint.attempt);
    let record: RemediationRecord | undefined;
    let diagnostic: string | undefined;
    try {
      const added = (await git.run(["diff-tree", "--no-commit-id", "--name-only", "--diff-filter=A", "-r", checkpoint.commit.hash, "--", path])).split("\n").includes(path);
      const value: unknown = JSON.parse(await git.run(["show", `${checkpoint.commit.hash}:${path}`]));
      const details = validationDetails("remediation", value);
      if (!added) diagnostic = `remediation record at ${path} was not added by the transition`;
      else if (!details.valid) diagnostic = `remediation record at ${path} is invalid: ${details.errors.join("; ")}`;
      else record = value as RemediationRecord;
    } catch (error) {
      diagnostic = error instanceof Error ? error.message : String(error);
    }
    let parent: string | undefined;
    try {
      parent = await git.parent(checkpoint.commit.hash);
    } catch {
      diagnostic = diagnostic ?? "remediation transition cannot be a root commit";
    }
    if (!record || !parent || record.workId !== checkpoint.work || record.source !== checkpoint.phase || record.target !== checkpoint.target
      || record.attempt !== checkpoint.attempt || record.priorCheckpoint !== parent) {
      issue(issues, checkpoint.commit, "history-invalid-remediation-evidence",
        diagnostic ?? `Remediation attempt ${checkpoint.attempt} for ${checkpoint.work} lacks matching transition evidence at ${path}`);
      continue;
    }
    try {
      const failure = await remediationEvidenceFailure(git, record, parent, checkpoint.commit.hash);
      if (failure) issue(issues, checkpoint.commit, "history-invalid-remediation-evidence", failure);
    } catch (error) {
      issue(issues, checkpoint.commit, "history-invalid-remediation-evidence", error instanceof Error ? error.message : String(error));
    }
  }
  return issues;
}

async function validationFailureIssues(
  git: GitRepository,
  commits: readonly CommitInfo[],
  contract: LifecycleContract,
): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];
  for (const commit of commits) {
    if (commit.trailers.state !== "validation-failed") continue;
    const attempt = parsedAttempt(commit.trailers.attempt, contract);
    if (!commit.trailers.work || !contract.isPhase(commit.trailers.phase) || commit.trailers.phase !== contract.validationPhase || attempt === undefined) {
      issue(issues, commit, "history-invalid-validation-failure", `Validation failure record has malformed work, attempt, or ${contract.validationPhase} phase trailers`);
      continue;
    }
    const failure = await committedValidationFailureFailure(git, commit.trailers.work, attempt, commit.hash);
    if (failure) issue(issues, commit, "history-invalid-validation-failure", failure);
  }
  return issues;
}


async function legacyTransitionArtifacts(
  git: GitRepository,
  commit: CommitInfo,
  work: string,
  attempt: number,
  contract: LifecycleContract,
): Promise<Set<string>> {
  const allowed = new Set<string>();
  if (commit.trailers.state !== "remediated") return allowed;
  try {
    const value: unknown = JSON.parse(await git.run(["show", `${commit.hash}:${remediationRecordPath(work, attempt)}`]));
    if (!validateRemediation(value) || value.workId !== work || value.attempt !== attempt) return allowed;
    allowed.add(remediationRecordPath(work, attempt));
    const sourceAttempt = attempt - 1;
    if (value.source === "review") {
      allowed.add(attemptPhasePath(work, sourceAttempt, contract.reviewPhase));
      allowed.add(attemptReviewPath(work, sourceAttempt));
    } else if (value.evidence.kind === "validate" && !("failureRecord" in value.evidence)) {
      // v1 validation remediation captured its inline failure marker in the previous validate artifact.
      allowed.add(attemptPhasePath(work, sourceAttempt, contract.validationPhase));
    }
  } catch {
    // The remediation evidence check reports malformed legacy records.
  }
  return allowed;
}

async function priorArtifactMutationIssues(
  git: GitRepository,
  commits: readonly CommitInfo[],
  contract: LifecycleContract,
): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];
  for (const commit of commits) {
    const { work, phase, state } = commit.trailers;
    const attempt = parsedAttempt(commit.trailers.attempt, contract);
    if (!work || attempt === undefined || attempt === 0 || state === "cancelled"
      || (state === "completed" && phase === contract.phases.at(-1))) continue;
    const allowed = new Set<string>();
    if (state?.startsWith("remediated-") && (phase === contract.reviewPhase || phase === contract.validationPhase)) {
      const sourceAttempt = attempt - 1;
      allowed.add(remediationRecordPath(work, attempt));
      if (phase === contract.reviewPhase) {
        allowed.add(attemptPhasePath(work, sourceAttempt, phase));
        allowed.add(attemptReviewPath(work, sourceAttempt));
      }
    }
    for (const path of await legacyTransitionArtifacts(git, commit, work, attempt, contract)) allowed.add(path);
    const changed = (await git.run(["diff-tree", "--no-commit-id", "--name-only", "-r", commit.hash])).split("\n").filter(Boolean);
    const protectedPath = changed.find((path) => !allowed.has(path) && isPriorAttemptArtifact(path, work, attempt));
    if (protectedPath) issue(issues, commit, "history-prior-artifact-mutated", `Prior SDD artifact was modified during attempt ${attempt}: ${protectedPath}`);
  }
  return issues;
}

export async function auditHistory(
  git: GitRepository,
  commits: readonly CommitInfo[],
  activeId?: string,
  schemaVersion: unknown = 1,
): Promise<{ issues: IntegrityIssue[]; checkpoints: HistoryCheckpoint[] }> {
  const contract = lifecycleContract(schemaVersion, "history contract");
  const transportOnlyMerges = await transportOnlyMergeHashes(git, commits, contract);
  const replayCommitsInput = await hydrateLegacyRemediations(git, commits, contract);
  const replayed = replayCommits(replayCommitsInput, activeId, contract.schemaVersion, transportOnlyMerges);
  return { ...replayed, issues: [
    ...replayed.issues,
    ...await remediationEvidenceIssues(git, replayed.checkpoints),
    ...await validationFailureIssues(git, commits, contract),
    ...await priorArtifactMutationIssues(git, commits, contract),
  ] };
}

export async function checkHistory(cwd: string, options: HistoryOptions = {}): Promise<IntegrityIssue[]> {
  const git = new GitRepository(cwd);
  const anchor = await resolveAnchor(cwd, git, options.since);
  if (!anchor) return [];
  let activeId: string | undefined;
  let schemaVersion: unknown = 1;
  try {
    const value: unknown = JSON.parse(await readFile(join(cwd, STATE_PATH), "utf8"));
    if (value !== null && typeof value === "object" && "schemaVersion" in value) schemaVersion = value.schemaVersion;
    if (validateState(value)) activeId = value.id;
  } catch {
    // Missing or unreadable state is reported by checkIntegrity.
  }
  try {
    return (await auditHistory(git, await commitsAfter(git, anchor, options.to), activeId, schemaVersion)).issues;
  } catch (error) {
    if (error instanceof Error && error.message.includes("unsupported lifecycle contract version")) {
      return [{ code: "history-unsupported-lifecycle-version", path: STATE_PATH, message: error.message }];
    }
    throw error;
  }
}
