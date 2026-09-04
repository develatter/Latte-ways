import { SDD_DIR } from "../domain/constants.js";
import type { RemediationMetadata, SddPhase } from "../domain/types.js";
import type { GitRepository } from "../git/git.js";

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

/** Resolve a transition from its committed parent identity, never from path history. */
export async function remediationTransitionCommit(
  git: GitRepository,
  workId: string,
  remediation: RemediationMetadata,
  descendant = "HEAD",
): Promise<string> {
  const candidates = (await git.run(["rev-list", "--reverse", "--ancestry-path", `${remediation.priorCheckpoint}..${descendant}`]))
    .split("\n").filter(Boolean);
  const transition = candidates[0];
  if (!transition || await git.parent(transition) !== remediation.priorCheckpoint) {
    throw new Error(`Remediation attempt ${remediation.attempt} has no transition child of its prior checkpoint`);
  }
  const info = await git.commitInfo(transition);
  const legacyTransition = info.trailers.state === "remediated";
  if (info.trailers.work !== workId || (!legacyTransition && info.trailers.phase !== remediation.source)
    || (!legacyTransition && info.trailers.state !== `remediated-${remediation.target}`) || info.trailers.attempt !== String(remediation.attempt)) {
    throw new Error(`Remediation attempt ${remediation.attempt} transition identity does not match its metadata`);
  }
  return transition;
}

/** True for immutable phase/evidence artifacts belonging to an earlier attempt. */
export function isPriorAttemptArtifact(path: string, workId: string, currentAttempt: number): boolean {
  const root = `${attemptArtifactDirectory(workId, 0)}/`;
  if (!path.startsWith(root) || currentAttempt <= 0) return false;
  const relative = path.slice(root.length);
  const nested = relative.match(/^attempts\/(\d+)\/(.+)$/);
  const artifactAttempt = nested ? Number(nested[1]) : 0;
  const artifact = nested ? nested[2]! : relative;
  if (artifactAttempt > currentAttempt) return false;
  if (artifactAttempt === currentAttempt) return artifact === "remediation.json";
  return /^(?:[a-z][a-z-]*\.md|remediation\.json|reviews\/[^/]+\.json|approvals\/[^/]+\.json)$/.test(artifact);
}
