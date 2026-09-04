import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runChecks, type CheckResult } from "../check/check.js";
import type {
  RemediationEvidence,
  RemediationRecord,
  RemediationTarget,
  ReviewResult,
  WorkState,
} from "../domain/types.js";
import { validateRemediation, validateReview } from "../domain/validation.js";
import { sha256, stableJson, writeAtomic } from "../fs/files.js";
import { GitRepository } from "../git/git.js";
import { loadState, saveState } from "../state/store.js";
import { attemptNumber, attemptPhasePath, attemptReviewPath, remediationRecordPath, remediationTransitionCommit } from "./attempt.js";
import { committedWorkDigest, implementationDigest } from "./digest.js";
import { assertSddConsistency, createSddPhaseFile } from "./sdd.js";

function requireSource(state: WorkState | undefined): WorkState & { phase: "review" | "validate" } {
  if (!state || state.mode !== "sdd" || (state.phase !== "review" && state.phase !== "validate")) {
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

async function failedReviewEvidence(cwd: string, state: WorkState): Promise<RemediationEvidence> {
  const path = attemptReviewPath(state.id, state.attempt);
  let value: unknown;
  try {
    value = JSON.parse(await readFile(join(cwd, path), "utf8"));
  } catch {
    throw new Error("A valid current failed review is required for remediation");
  }
  if (!validateReview(value)) throw new Error("A valid current failed review is required for remediation");
  const review = value as ReviewResult;
  if (!review.reviewer.trim()) throw new Error("A valid current failed review is required for remediation");
  if (review.workId !== state.id || attemptNumber(review.attempt) !== attemptNumber(state.attempt)) {
    throw new Error("Failed review belongs to another work or remediation attempt");
  }
  if (review.verdict !== "fail") throw new Error("A passing review cannot be used as remediation evidence");
  if (review.digest !== await implementationDigest(cwd, state)) {
    throw new Error("Failed review is stale: content changed after it was submitted");
  }
  return { kind: "review", review: review as ReviewResult & { verdict: "fail" } };
}

function validationEvidence(result: CheckResult): RemediationEvidence {
  const failures = result.issues.map((issue) => ({
    check: `integrity:${issue.code}`,
    detail: `${issue.path}: ${issue.message}`,
  }));
  if (result.testExitCode !== undefined && result.testExitCode !== 0) {
    failures.push({ check: "configured-tests", detail: `Configured test command exited with status ${result.testExitCode}` });
  }
  if (failures.length === 0) throw new Error("Passing validation cannot be used as remediation evidence");
  return { kind: "validate", failures };
}

export function failureEvidenceDigest(evidence: RemediationEvidence): string {
  return sha256(stableJson(evidence));
}

/** Record the exact evidence object in the failed phase artifact without replacing human context. */
async function recordFailureGate(cwd: string, state: WorkState, evidence: RemediationEvidence): Promise<void> {
  const path = join(cwd, attemptPhasePath(state.id, state.attempt, state.phase!));
  const marker = `Failure-Digest: ${failureEvidenceDigest(evidence)}`;
  let content = await readFile(path, "utf8");
  content = content.replace(/^Decision:\s*.*$/m, "Decision: fail").replace(/^Gate:\s*.*$/m, "Gate: remediate");
  content = /^Failure-Digest:\s*.*$/m.test(content)
    ? content.replace(/^Failure-Digest:\s*.*$/m, marker)
    : `${content.trimEnd()}\n${marker}\n`;
  await writeAtomic(path, content);
}

async function certificationBefore(git: GitRepository, workId: string, phase: string, ref: string): Promise<string> {
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
  const changed = new Set((await git.run(["diff", "--name-only", parent, ref])).split("\n").filter(Boolean));
  if (record.evidence.kind === "review") {
    const sourceAttempt = record.attempt - 1;
    const reviewPath = attemptReviewPath(record.workId, sourceAttempt);
    if (!changed.has(reviewPath)) return `failed review was not submitted at ${reviewPath} in the transition`;
    let submitted: ReviewResult;
    try {
      const value: unknown = JSON.parse(await git.run(["show", `${ref}:${reviewPath}`]));
      if (!validateReview(value)) return `failed review at ${reviewPath} is invalid`;
      submitted = value;
    } catch {
      return `failed review is missing at ${reviewPath}`;
    }
    if (JSON.stringify(submitted) !== JSON.stringify(record.evidence.review) || submitted.workId !== record.workId
      || attemptNumber(submitted.attempt) !== sourceAttempt || submitted.verdict !== "fail" || !submitted.reviewer.trim()) {
      return "remediation review evidence does not match the submitted failed review";
    }
    let baseline: string;
    if (sourceAttempt === 0) {
      baseline = await certificationBefore(git, record.workId, "decompose", parent);
    } else {
      const priorPath = remediationRecordPath(record.workId, sourceAttempt);
      let prior: RemediationRecord;
      try {
        const value: unknown = JSON.parse(await git.run(["show", `${parent}:${priorPath}`]));
        if (!validateRemediation(value)) return `prior remediation evidence at ${priorPath} is invalid`;
        prior = value;
      } catch {
        return `prior remediation evidence is missing at ${priorPath}`;
      }
      baseline = await remediationTransitionCommit(git, record.workId, prior, parent);
    }
    const digest = await committedWorkDigest(git, baseline, ref, [
      remediationRecordPath(record.workId, record.attempt),
      attemptPhasePath(record.workId, record.attempt, record.target),
    ]);
    if (submitted.digest !== digest) return "failed review digest does not bind the implementation captured by the transition";
    return undefined;
  }

  const validatePath = attemptPhasePath(record.workId, record.attempt - 1, "validate");
  if (!changed.has(validatePath)) return `failed validation gate was not captured at ${validatePath} in the transition`;
  try {
    const source = await git.run(["show", `${ref}:${validatePath}`]);
    if (!/^Decision:\s*fail\s*$/m.test(source) || !/^Gate:\s*remediate\s*$/m.test(source)
      || !new RegExp(`^Failure-Digest:\\s*${failureEvidenceDigest(record.evidence)}\\s*$`, "m").test(source)) {
      return `failed validation gate at ${validatePath} is not bound to remediation evidence`;
    }
  } catch {
    return `failed validation gate is missing at ${validatePath}`;
  }
  const seen = new Set<string>();
  for (const failure of record.evidence.failures) {
    if (seen.has(failure.check)) return `validation evidence duplicates ${failure.check}`;
    seen.add(failure.check);
    if (failure.check === "configured-tests") {
      if (!/^Configured test command exited with status [1-9]\d*$/.test(failure.detail)) return "configured test failure has no valid nonzero exit status";
    } else if (failure.check.startsWith("integrity:")) {
      if (!/^.+: .+$/.test(failure.detail)) return `integrity failure ${failure.check} lacks deterministic path and detail evidence`;
    } else {
      return `validation evidence names an unknown check: ${failure.check}`;
    }
  }
  return undefined;
}

export async function remediateSdd(cwd: string, target: RemediationTarget, reason: string): Promise<string> {
  const state = requireSource(await loadState(cwd));
  const normalizedReason = reason.trim();
  if (!normalizedReason) throw new Error("A nonempty remediation reason is required");

  await assertSddConsistency(cwd, state);
  const git = new GitRepository(cwd);
  const reviewPath = attemptReviewPath(state.id, state.attempt);
  const allowed = new Set([attemptPhasePath(state.id, state.attempt, state.phase)]);
  if (state.phase === "review") allowed.add(reviewPath);
  const evidence = state.phase === "review"
    ? await failedReviewEvidence(cwd, state)
    : undefined;
  await assertOnlyAllowedChanges(git, allowed);
  const capturedEvidence = evidence ?? validationEvidence(await runChecks(cwd));
  // Tests and integrity checks are not allowed to leave content behind.
  await assertOnlyAllowedChanges(git, allowed);
  if (state.phase === "validate") await recordFailureGate(cwd, state, capturedEvidence);

  const priorCheckpoint = await git.head();
  const source = state.phase;
  const mutableState: WorkState = state;
  const attempt = attemptNumber(state.attempt) + 1;
  if (!Number.isSafeInteger(attempt)) throw new Error("Remediation attempt exceeds the supported range");
  const timestamp = new Date().toISOString();
  const record: RemediationRecord = {
    schemaVersion: 1,
    workId: state.id,
    source,
    target,
    reason: normalizedReason,
    evidence: capturedEvidence,
    priorCheckpoint,
    attempt,
    timestamp,
  };
  if (!validateRemediation(record)) throw new Error("Refusing to write invalid remediation evidence");

  const recordPath = remediationRecordPath(state.id, attempt);
  await writeAtomic(join(cwd, recordPath), stableJson(record));
  mutableState.attempt = attempt;
  mutableState.remediation = {
    source: record.source,
    target: record.target,
    reason: record.reason,
    evidence: record.evidence,
    priorCheckpoint,
    attempt,
    timestamp,
  };
  mutableState.phase = target;
  delete mutableState.lastCompletedPhase;
  mutableState.gateCommit = priorCheckpoint;
  mutableState.updatedAt = timestamp;
  await createSddPhaseFile(cwd, mutableState, target);
  await saveState(cwd, mutableState);

  return git.commit(await git.changedPaths(), `sdd(${record.source}): remediate ${mutableState.id} to ${target}`, {
    work: mutableState.id,
    phase: record.source,
    state: `remediated-${target}`,
    attempt: String(attempt),
  });
}
