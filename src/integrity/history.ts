import { MANIFEST_PATH } from "../domain/constants.js";
import { SDD_PHASES, type SddPhase } from "../domain/types.js";
import { loadConfig } from "../config/config.js";
import { GitRepository, type CommitInfo } from "../git/git.js";
import { loadState } from "../state/store.js";
import type { IntegrityIssue } from "./integrity.js";

export interface HistoryOptions {
  since?: string;
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

export async function commitsAfter(git: GitRepository, anchor: string): Promise<CommitInfo[]> {
  const output = await git.run(["rev-list", "--topo-order", "--reverse", `${anchor}..HEAD`]);
  const commits: CommitInfo[] = [];
  for (const hash of output.split("\n").filter(Boolean)) commits.push(await git.commitInfo(hash));
  return commits;
}

export function auditCommits(commits: readonly CommitInfo[], activeId?: string): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const certified = new Map<string, Set<SddPhase>>();
  const opened = new Map<string, string>();
  for (const commit of commits) {
    const { work, phase, state } = commit.trailers;
    const path = commit.hash.slice(0, 12);
    if (!work || (!state && !commit.trailers.task)) {
      issues.push({ code: "history-untraced", path, message: `Commit "${commit.subject}" lacks Harness-Work with Harness-State or Harness-Task trailers` });
      continue;
    }
    if (state === "opened") opened.set(work, path);
    else if (state === "completed" || state === "cancelled") opened.delete(work);
    if (state !== "completed" || !phase || !SDD_PHASES.includes(phase as SddPhase)) continue;
    const completed = phase as SddPhase;
    const previous = SDD_PHASES[SDD_PHASES.indexOf(completed) - 1];
    const seen = certified.get(work) ?? new Set<SddPhase>();
    if (previous && !seen.has(previous)) {
      issues.push({ code: "history-broken-chain", path, message: `Certification of ${completed} for ${work} has no earlier ${previous} certification` });
    }
    seen.add(completed);
    certified.set(work, seen);
  }
  for (const [work, path] of opened) {
    if (work !== activeId) issues.push({ code: "history-abandoned-opening", path, message: `Supervised work ${work} was opened but never certified or closed` });
  }
  return issues;
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
  return auditCommits(await commitsAfter(git, anchor), activeId);
}
