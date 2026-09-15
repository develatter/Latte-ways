import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  RemediationEvidence,
  RemediationRecord,
  RemediationTarget,
  ReviewResult,
  SddPhase,
  WorkState,
} from "../domain/types.js";
import { recordVersion, type LifecycleContract } from "../domain/lifecycle.js";
import { validateRemediation, validateReview, validationDetails } from "../domain/validation.js";
import { sha256, stableJson, writeAtomic } from "../fs/files.js";
import { GitRepository } from "../git/git.js";
import { loadState, saveState } from "../state/store.js";
import { attemptPhasePath, attemptReviewPath, remediationRecordPath, remediationTransitionCommit, validationFailureRecordPath } from "./attempt.js";
import { committedWorkDigest, implementationDigest } from "./digest.js";
import { assertSddConsistency, createSddPhaseFile } from "./sdd.js";
import { currentValidationFailureRecord, committedValidationFailureFailure, legacyValidationFailureReplayFailure } from "./validation-failure.js";
function requireSource(state: WorkState | undefined): WorkState & { phase: "review" | "validate" } {
  if (!state || state.mode !== "sdd") throw new Error("SDD remediation is allowed only from review or validate");
  const contract = recordVersion(state, "SDD state");
  if (state.phase !== contract.reviewPhase && state.phase !== contract.validationPhase) {
    throw new Error("SDD remediation is allowed only from review or validate");
  }
  return state as WorkState & { phase: "review" | "validate" };
}

async function changedPaths(git: GitRepository): Promise<Set<string>> {
  const commands = [
    ["diff", "--name-only"],
    ["diff", "--cached", "--name-only"],
    ["ls-files", "--others", "--exclude-standard"],
  ] as const;
  const paths = new Set<string>();
  for (const command of commands) {
    for (const path of (await git.run(command)).split("\n")) if (path) paths.add(path);
  }
  return paths;
}

async function assertOnlyAllowedChanges(git: GitRepository, allowed: ReadonlySet<string>): Promise<void> {
  const unrelated = [...await changedPaths(git)].filter((path) => !allowed.has(path)).sort();
  if (unrelated.length > 0) throw new Error(`Unrelated dirty or staged content blocks remediation: ${unrelated.join(", ")}`);
}

async function failedReviewEvidence(cwd: string, state: WorkState, contract: LifecycleContract): Promise<RemediationEvidence> {
  const path = attemptReviewPath(state.id, contract.attemptNumber(state.attempt));
  let value: unknown;
  try {
    value = JSON.parse(await readFile(join(cwd, path), "utf8"));
  } catch {
    throw new Error("A valid current failed review is required for remediation");
  }
  const details = validationDetails("review", value);
  if (!validateReview(value)) throw new Error(`A valid current failed review is required for remediation: ${details.errors.join("; ")}`);
  const review = value;
  if (!review.reviewer.trim()) throw new Error("A valid current failed review is required for remediation");
  if (review.workId !== state.id || contract.attemptNumber(review.attempt) !== contract.attemptNumber(state.attempt)) {
    throw new Error("Failed review belongs to another work or remediation attempt");
  }
  if (review.verdict !== "fail") throw new Error("A passing review cannot be used as remediation evidence");
  if (review.digest !== await implementationDigest(cwd, state)) {
    throw new Error("Failed review is stale: content changed after it was submitted");
  }
  return { kind: "review", review: review as ReviewResult & { verdict: "fail" } };
}

export function failureEvidenceDigest(evidence: RemediationEvidence): string {
  return sha256(stableJson(evidence));
}

async function failedValidationEvidence(git: GitRepository, state: WorkState, contract: LifecycleContract): Promise<RemediationEvidence> {
  if (state.phase !== contract.validationPhase) throw new Error("Validation evidence requires the validate phase");
  const failure = await currentValidationFailureRecord(git, state);
  return {
    kind: "validate",
    failureRecord: {
      commit: await git.head(),
      tree: await git.run(["rev-parse", "HEAD^{tree}"]),
      digest: failure.digest,
    },
  };
}
async function certificationBefore(git: GitRepository, workId: string, phase: string, ref: string, contract: LifecycleContract): Promise<string> {
  if (!contract.isPhase(phase)) throw new Error(`Cannot locate certification for unknown phase ${phase}`);
  for (const hash of (await git.run(["rev-list", ref])).split("\n").filter(Boolean)) {
    const info = await git.commitInfo(hash);
    if (info.trailers.work === workId && info.trailers.phase === phase && info.trailers.state === "completed") return hash;
  }
  throw new Error(`No ${phase} certification exists before remediation`);
}

/** Verify the failure evidence against the exact tree captured by a remediation transition. */
export async function remediationEvidenceFailure(
  git: GitRepository,
  record: RemediationRecord,
  parent: string,
  ref: string,
): Promise<string | undefined> {
  const contract = recordVersion(record, "remediation record");
  const changed = new Set((await git.run(["diff", "--name-only", parent, ref])).split("\n").filter(Boolean));
  if (record.evidence.kind === "review") {
    const sourceAttempt = contract.attemptNumber(record.attempt) - 1;
    const reviewPath = attemptReviewPath(record.workId, sourceAttempt);
    if (!changed.has(reviewPath)) return `failed review was not submitted at ${reviewPath} in the transition`;
    let submitted: ReviewResult;
    try {
      const value: unknown = JSON.parse(await git.run(["show", `${ref}:${reviewPath}`]));
      if (!validateReview(value)) return `failed review at ${reviewPath} is invalid: ${validationDetails("review", value).errors.join("; ")}`;
      submitted = value;
    } catch (error) {
      return error instanceof Error ? `failed review at ${reviewPath} is missing or invalid: ${error.message}` : `failed review at ${reviewPath} is missing`;
    }
    if (JSON.stringify(submitted) !== JSON.stringify(record.evidence.review) || submitted.workId !== record.workId
      || contract.attemptNumber(submitted.attempt) !== sourceAttempt || submitted.verdict !== "fail" || !submitted.reviewer.trim()) {
      return "remediation review evidence does not match the submitted failed review";
    }
    let baseline: string;
    if (sourceAttempt === 0) {
      baseline = await certificationBefore(git, record.workId, contract.decomposePhase, parent, contract);
    } else {
      const priorPath = remediationRecordPath(record.workId, sourceAttempt);
      let prior: RemediationRecord;
      try {
        const value: unknown = JSON.parse(await git.run(["show", `${parent}:${priorPath}`]));
        if (!validateRemediation(value)) return `prior remediation evidence at ${priorPath} is invalid: ${validationDetails("remediation", value).errors.join("; ")}`;
        prior = value;
        recordVersion(prior, `prior remediation record at ${priorPath}`);
      } catch (error) {
        return error instanceof Error ? error.message : `prior remediation evidence is missing at ${priorPath}`;
      }
      baseline = await remediationTransitionCommit(git, record.workId, prior, parent);
    }
    const digest = await committedWorkDigest(git, baseline, ref, [
      remediationRecordPath(record.workId, contract.attemptNumber(record.attempt)),
      attemptPhasePath(record.workId, contract.attemptNumber(record.attempt), record.target),
    ]);
    if (submitted.digest !== digest) return "failed review digest does not bind the implementation captured by the transition";
    return undefined;
  }
  if ("failureRecord" in record.evidence) {
    const linked = record.evidence.failureRecord;
    const sourceAttempt = contract.attemptNumber(record.attempt) - 1;
    if (linked.commit !== parent || linked.tree !== await git.run(["rev-parse", `${parent}^{tree}`])) {
      return "remediation validation evidence is not linked to its immediate committed failure record";
    }
    const failure = await committedValidationFailureFailure(git, record.workId, sourceAttempt, linked.commit);
    if (failure) return failure;
    try {
      const value: unknown = JSON.parse(await git.run(["show", `${linked.commit}:${validationFailureRecordPath(record.workId, sourceAttempt)}`]));
      if (value === null || typeof value !== "object" || !("digest" in value) || value.digest !== linked.digest) {
        return "remediation validation evidence does not match the committed failure digest";
      }
    } catch {
      return "remediation validation evidence cannot read its committed failure record";
    }
    return undefined;
  }

  // v1 remediation records carried inline failures and a phase marker. Keep
  // their history readable only when the claimed normalized result replays at
  // the exact committed validation input; new transitions never take this path.
  if (record.priorCheckpoint !== parent) return "legacy validation remediation does not bind its committed input";
  const validatePath = attemptPhasePath(record.workId, contract.attemptNumber(record.attempt) - 1, contract.validationPhase);
  if (!changed.has(validatePath)) return `failed validation gate was not captured at ${validatePath} in the transition`;
  try {
    const source = await git.run(["show", `${ref}:${validatePath}`]);
    const markers = [...source.matchAll(/^Failure-Digest:\s*(\S+)\s*$/gm)];
    if (!/^Decision:\s*fail\s*$/m.test(source) || !/^Gate:\s*remediate\s*$/m.test(source)
      || markers.length !== 1 || markers[0]![1] !== failureEvidenceDigest(record.evidence)) {
      return `failed validation gate at ${validatePath} is not bound to remediation evidence`;
    }
  } catch {
    return `failed validation gate is missing at ${validatePath}`;
  }
  return legacyValidationFailureReplayFailure(git, parent, record.evidence);
}

export async function remediateSdd(cwd: string, target: RemediationTarget, reason: string): Promise<string> {
  const state = requireSource(await loadState(cwd));
  const contract = recordVersion(state, "SDD state");
  if (!contract.isRemediationTarget(target)) throw new Error(`Unsupported remediation target ${String(target)}; supported targets: ${contract.remediationTargets.join(", ")}`);
  const normalizedReason = reason.trim();
  if (!normalizedReason) throw new Error("A nonempty remediation reason is required");

  await assertSddConsistency(cwd, state);
  const git = new GitRepository(cwd);
  const currentAttempt = contract.attemptNumber(state.attempt);
  const nextAttempt = currentAttempt + 1;
  if (!Number.isSafeInteger(nextAttempt)) throw new Error("Remediation attempt exceeds the supported range");
  const transitionFailure = contract.remediationFailure({
    workId: state.id,
    sourcePhase: state.phase,
    currentPhase: state.phase,
    target,
    attempt: nextAttempt,
    expectedAttempt: currentAttempt,
  });
  if (transitionFailure) throw new Error(transitionFailure);
  const reviewPath = attemptReviewPath(state.id, currentAttempt);
  const allowed = new Set(state.phase === contract.reviewPhase
    ? [attemptPhasePath(state.id, currentAttempt, contract.reviewPhase), reviewPath]
    : []);
  const capturedEvidence = state.phase === contract.reviewPhase
    ? await failedReviewEvidence(cwd, state, contract)
    : await failedValidationEvidence(git, state, contract);
  await assertOnlyAllowedChanges(git, allowed);

  const priorCheckpoint = await git.head();
  const source = state.phase;
  const timestamp = new Date().toISOString();
  const record: RemediationRecord = {
    schemaVersion: contract.schemaVersion,
    workId: state.id,
    source,
    target,
    reason: normalizedReason,
    evidence: capturedEvidence,
    priorCheckpoint,
    attempt: nextAttempt,
    timestamp,
  };
  if (!validateRemediation(record)) throw new Error(`Refusing to write invalid remediation evidence: ${validationDetails("remediation", record).errors.join("; ")}`);

  const recordPath = remediationRecordPath(state.id, nextAttempt);
  await writeAtomic(join(cwd, recordPath), stableJson(record));
  state.attempt = nextAttempt;
  state.remediation = {
    source: record.source,
    target: record.target,
    reason: record.reason,
    evidence: record.evidence,
    priorCheckpoint,
    attempt: nextAttempt,
    timestamp,
  };
  (state as WorkState).phase = target as SddPhase;
  delete state.lastCompletedPhase;
  state.gateCommit = priorCheckpoint;
  state.updatedAt = timestamp;
  await createSddPhaseFile(cwd, state, target);
  await saveState(cwd, state);

  return git.commit(await git.changedPaths(), `sdd(${record.source}): remediate ${state.id} to ${target}`, {
    work: state.id,
    phase: record.source,
    state: `remediated-${target}`,
    attempt: String(nextAttempt),
  });
}
