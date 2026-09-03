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
import { stableJson, writeAtomic } from "../fs/files.js";
import { GitRepository } from "../git/git.js";
import { loadState, saveState } from "../state/store.js";
import { attemptNumber, attemptReviewPath, remediationRecordPath } from "./attempt.js";
import { implementationDigest } from "./digest.js";
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

export async function remediateSdd(cwd: string, target: RemediationTarget, reason: string): Promise<string> {
  const state = requireSource(await loadState(cwd));
  const normalizedReason = reason.trim();
  if (!normalizedReason) throw new Error("A nonempty remediation reason is required");

  await assertSddConsistency(cwd, state);
  const git = new GitRepository(cwd);
  const reviewPath = attemptReviewPath(state.id, state.attempt);
  const allowed = state.phase === "review" ? new Set([reviewPath]) : new Set<string>();
  const evidence = state.phase === "review"
    ? await failedReviewEvidence(cwd, state)
    : undefined;
  await assertOnlyAllowedChanges(git, allowed);
  const capturedEvidence = evidence ?? validationEvidence(await runChecks(cwd));
  // Tests and integrity checks are not allowed to leave content behind.
  await assertOnlyAllowedChanges(git, allowed);

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
