import { SDD_DIR } from "../domain/constants.js";
import type { SddPhase } from "../domain/types.js";

/** v1 artifacts have no attempt field and remain in the original work directory. */
export function attemptNumber(attempt: number | undefined): number {
  const value = attempt ?? 0;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Attempt must be a non-negative integer");
  return value;
}

function workDirectory(workId: string): string {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(workId)) throw new Error("Work id must be a lowercase slug");
  return `${SDD_DIR}/${workId}`;
}

/**
 * Returns the directory for an attempt. Attempt zero deliberately uses the v1
 * layout so existing phase, review, and approval artifacts remain readable.
 */
export function attemptArtifactDirectory(workId: string, attempt: number | undefined): string {
  const normalized = attemptNumber(attempt);
  const root = workDirectory(workId);
  return normalized === 0 ? root : `${root}/attempts/${normalized}`;
}

/** Build an attempt-scoped artifact path without allowing arbitrary path segments. */
export function attemptArtifactPath(workId: string, attempt: number | undefined, ...segments: readonly string[]): string {
  if (segments.length === 0 || segments.some((segment) => typeof segment !== "string" || !/^[a-z][a-z0-9-]*(?:\.[a-z0-9]+)?$/.test(segment))) {
    throw new Error("Attempt artifact path requires safe path segments");
  }
  return `${attemptArtifactDirectory(workId, attempt)}/${segments.join("/")}`;
}

export function attemptPhasePath(workId: string, attempt: number | undefined, phase: SddPhase): string {
  return attemptArtifactPath(workId, attempt, `${phase}.md`);
}

export function attemptReviewPath(workId: string, attempt: number | undefined): string {
  return attemptArtifactPath(workId, attempt, "reviews", "latest.json");
}

export function attemptApprovalPath(workId: string, attempt: number | undefined, phase: SddPhase): string {
  return attemptArtifactPath(workId, attempt, "approvals", `${phase}.json`);
}

export function remediationRecordPath(workId: string, attempt: number): string {
  if (attemptNumber(attempt) === 0) throw new Error("A remediation record requires attempt one or later");
  return attemptArtifactPath(workId, attempt, "remediation.json");
}
