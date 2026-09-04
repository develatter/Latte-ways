import { MANIFEST_PATH } from "../domain/constants.js";
import { SDD_PHASES, type RemediationRecord, type RemediationTarget, type SddPhase } from "../domain/types.js";
import { validateRemediation } from "../domain/validation.js";
import { loadConfig } from "../config/config.js";
import { GitRepository, type CommitInfo } from "../git/git.js";
import { loadState } from "../state/store.js";
import { attemptPhasePath, attemptReviewPath, isPriorAttemptArtifact, remediationRecordPath } from "../work/attempt.js";
import { remediationEvidenceFailure } from "../work/remediation.js";
import type { IntegrityIssue } from "./integrity.js";

export interface HistoryOptions {
  since?: string;
}

export interface HistoryCheckpoint {
  work: string;
  attempt: number;
  kind: "certification" | "remediation";
  commit: CommitInfo;
  phase: SddPhase;
  target?: RemediationTarget;
}

const REMEDIATION_TARGETS = new Set<RemediationTarget>(["implement", "decompose", "plan", "specify"]);

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

export async function commitsAfter(git: GitRepository, anchor: string): Promise<CommitInfo[]> {
  const output = await git.run(["rev-list", "--topo-order", "--reverse", `${anchor}..HEAD`]);
  const commits: CommitInfo[] = [];
  for (const hash of output.split("\n").filter(Boolean)) commits.push(await git.commitInfo(hash));
  return commits;
}

interface ReplayState {
  attempt: number;
  nextPhase: SddPhase;
}

function issue(issues: IntegrityIssue[], commit: CommitInfo, code: string, message: string): void {
  issues.push({ code, path: commit.hash.slice(0, 12), message });
}

function parsedAttempt(value: string | undefined): number | undefined {
  if (value === undefined) return 0;
  if (!/^(?:0|[1-9]\d*)$/.test(value)) return undefined;
  const attempt = Number(value);
  return Number.isSafeInteger(attempt) ? attempt : undefined;
}

/** Replay ordered SDD history. A set is insufficient because repeated and backward gates are invalid. */
export function replayCommits(commits: readonly CommitInfo[], activeId?: string): { issues: IntegrityIssue[]; checkpoints: HistoryCheckpoint[] } {
  const issues: IntegrityIssue[] = [];
  const checkpoints: HistoryCheckpoint[] = [];
  const replay = new Map<string, ReplayState>();
  const opened = new Map<string, string>();

  for (const commit of commits) {
    const { work, phase, state } = commit.trailers;
    if (!work || (!state && !commit.trailers.task)) {
      issue(issues, commit, "history-untraced", `Commit "${commit.subject}" lacks Harness-Work with Harness-State or Harness-Task trailers`);
      continue;
    }
    if (state === "opened") opened.set(work, commit.hash.slice(0, 12));
    else if (state === "completed" || state === "cancelled") opened.delete(work);

    const current = replay.get(work) ?? { attempt: 0, nextPhase: "intake" };
    if (commit.trailers.task && parsedAttempt(commit.trailers.attempt) !== current.attempt) {
      issue(issues, commit, "history-attempt-mismatch", `Task commit for ${work} does not belong to remediation attempt ${current.attempt}`);
      continue;
    }
    if (state === "approved" && (phase !== current.nextPhase || parsedAttempt(commit.trailers.attempt) !== current.attempt)) {
      issue(issues, commit, "history-attempt-mismatch", `Approval commit for ${work} does not belong to the current phase and remediation attempt`);
      continue;
    }
    const remediationMatch = state?.match(/^remediated-(.+)$/);
    if (state?.startsWith("remediated") && !remediationMatch) {
      issue(issues, commit, "history-invalid-remediation", `Remediation transition for ${work} has a malformed Harness-State trailer`);
      continue;
    }
    if (remediationMatch) {
      const target = remediationMatch[1] as RemediationTarget;
      const attempt = parsedAttempt(commit.trailers.attempt);
      if ((phase !== "review" && phase !== "validate") || phase !== current.nextPhase || !REMEDIATION_TARGETS.has(target)
        || attempt === undefined || attempt !== current.attempt + 1) {
        issue(issues, commit, "history-invalid-remediation", `Remediation transition for ${work} is not a legal ${current.nextPhase} attempt ${current.attempt + 1} transition`);
        continue;
      }
      replay.set(work, { attempt, nextPhase: target });
      checkpoints.push({ work, attempt, kind: "remediation", commit, phase: phase as SddPhase, target });
      continue;
    }

    if (state !== "completed" || !phase || !SDD_PHASES.includes(phase as SddPhase)) continue;
    const attempt = parsedAttempt(commit.trailers.attempt);
    const completed = phase as SddPhase;
    if (attempt === undefined || attempt !== current.attempt || completed !== current.nextPhase) {
      issue(issues, commit, "history-broken-chain", `Certification of ${completed} for ${work} is out of order for attempt ${current.attempt}; expected ${current.nextPhase}`);
      continue;
    }
    const next = SDD_PHASES[SDD_PHASES.indexOf(completed) + 1];
    if (next) replay.set(work, { attempt: current.attempt, nextPhase: next });
    else replay.delete(work);
    checkpoints.push({ work, attempt, kind: "certification", commit, phase: completed });
  }

  for (const [work, path] of opened) {
    if (work !== activeId) issues.push({ code: "history-abandoned-opening", path, message: `Supervised work ${work} was opened but never certified or closed` });
  }
  return { issues, checkpoints };
}

export function auditCommits(commits: readonly CommitInfo[], activeId?: string): IntegrityIssue[] {
  return replayCommits(commits, activeId).issues;
}

async function remediationEvidenceIssues(git: GitRepository, checkpoints: readonly HistoryCheckpoint[]): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];
  for (const checkpoint of checkpoints) {
    if (checkpoint.kind !== "remediation" || !checkpoint.target) continue;
    const path = remediationRecordPath(checkpoint.work, checkpoint.attempt);
    let record: RemediationRecord | undefined;
    try {
      const added = (await git.run(["diff-tree", "--no-commit-id", "--name-only", "--diff-filter=A", "-r", checkpoint.commit.hash, "--", path])).split("\n").includes(path);
      const value: unknown = JSON.parse(await git.run(["show", `${checkpoint.commit.hash}:${path}`]));
      if (added && validateRemediation(value)) record = value;
    } catch {
      // Report one stable issue below.
    }
    let parent: string | undefined;
    try {
      parent = await git.parent(checkpoint.commit.hash);
    } catch {
      // A transition cannot be a root commit.
    }
    if (!record || !parent || record.workId !== checkpoint.work || record.source !== checkpoint.phase || record.target !== checkpoint.target
      || record.attempt !== checkpoint.attempt || record.priorCheckpoint !== parent) {
      issue(issues, checkpoint.commit, "history-invalid-remediation-evidence", `Remediation attempt ${checkpoint.attempt} for ${checkpoint.work} lacks matching transition evidence at ${path}`);
      continue;
    }
    try {
      const failure = await remediationEvidenceFailure(git, record, parent, checkpoint.commit.hash);
      if (failure) issue(issues, checkpoint.commit, "history-invalid-remediation-evidence", failure);
    } catch {
      issue(issues, checkpoint.commit, "history-invalid-remediation-evidence", `Remediation attempt ${checkpoint.attempt} evidence cannot be bound to its transition tree`);
    }
  }
  return issues;
}

async function priorArtifactMutationIssues(git: GitRepository, commits: readonly CommitInfo[]): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];
  for (const commit of commits) {
    const { work, phase, state } = commit.trailers;
    const attempt = parsedAttempt(commit.trailers.attempt);
    if (!work || attempt === undefined || attempt === 0 || state === "cancelled"
      || (state === "completed" && phase === "close")) continue;
    const allowed = new Set<string>();
    if (state?.startsWith("remediated-") && (phase === "review" || phase === "validate")) {
      const sourceAttempt = attempt - 1;
      allowed.add(remediationRecordPath(work, attempt));
      allowed.add(attemptPhasePath(work, sourceAttempt, phase));
      if (phase === "review") allowed.add(attemptReviewPath(work, sourceAttempt));
    }
    const changed = (await git.run(["diff-tree", "--no-commit-id", "--name-only", "-r", commit.hash])).split("\n").filter(Boolean);
    const protectedPath = changed.find((path) => !allowed.has(path) && isPriorAttemptArtifact(path, work, attempt));
    if (protectedPath) issue(issues, commit, "history-prior-artifact-mutated", `Prior SDD artifact was modified during attempt ${attempt}: ${protectedPath}`);
  }
  return issues;
}

export async function auditHistory(git: GitRepository, commits: readonly CommitInfo[], activeId?: string): Promise<{ issues: IntegrityIssue[]; checkpoints: HistoryCheckpoint[] }> {
  const replayed = replayCommits(commits, activeId);
  return { ...replayed, issues: [
    ...replayed.issues,
    ...await remediationEvidenceIssues(git, replayed.checkpoints),
    ...await priorArtifactMutationIssues(git, commits),
  ] };
}

export async function checkHistory(cwd: string, options: HistoryOptions = {}): Promise<IntegrityIssue[]> {
  const git = new GitRepository(cwd);
  const anchor = await resolveAnchor(cwd, git, options.since);
  if (!anchor) return [];
  let activeId: string | undefined;
  try {
    activeId = (await loadState(cwd))?.id;
  } catch {
    // An unreadable state is reported by checkIntegrity.
  }
  return (await auditHistory(git, await commitsAfter(git, anchor), activeId)).issues;
}
