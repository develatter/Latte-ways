import { createHash } from "node:crypto";
import type { MemoryConfig } from "../domain/types.js";
import { GitRepository } from "../git/git.js";
import { matchesGlob, normalizeRepoPath } from "./glob.js";
import { canonicalCodeTreeDigest, isRelevantPath } from "./digest.js";
import type { MemoryIssue, MemoryState, ReconciliationDisposition, ReconciliationEvidence } from "./model.js";

const RECONCILIATION_ALLOWLIST = [
  ".ways/knowledge/**/*.md",
  ".ways/knowledge/coverage/**/*.json",
  ".ways/knowledge/state.json",
  ".ways/reconciliation/**/*.json",
  ".ways/reconciliations/**/*.json",
] as const;

export interface ReconciliationRequest {
  /** Previously published memory state. This is the compare-and-swap value. */
  state: MemoryState;
  /** Immutable integration/trunk code snapshot, before reconciliation-only commits. */
  candidateRef: string;
  /** Tip containing only reconciliation-allowlisted changes after candidateRef. */
  reconcileRef: string;
  /** Current release target. Named refs are recommended so movement is detected. */
  targetRef: string;
  dispositions: readonly ReconciliationDisposition[];
  /** Digest supplied by the independent semantic review. */
  reviewDigest?: string;
  candidateBranch?: string;
  unresolvedClaims?: readonly string[];
}

export interface CandidateValidation {
  evidence: ReconciliationEvidence;
  reconcile: string;
  mergedTree: string;
  changedRelevantPaths: string[];
  issues: MemoryIssue[];
}

export interface PublicationValidation {
  publication: string;
  reconcile: string;
  issues: MemoryIssue[];
}

export interface BackSyncValidation {
  status: "merged" | "already-synchronized";
  issues: MemoryIssue[];
}

function issue(code: string, path: string, message: string): MemoryIssue {
  return { code, path, message };
}

function stableEvidencePayload(evidence: ReconciliationEvidence): string {
  return JSON.stringify({
    schemaVersion: evidence.schemaVersion,
    generation: evidence.generation,
    base: evidence.base,
    candidate: evidence.candidate,
    target: evidence.target,
    codeTreeDigest: evidence.codeTreeDigest,
    dispositions: [...evidence.dispositions]
      .map((item) => ({ ...item, concepts: [...item.concepts].sort() }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  });
}

/** Digest of the compact semantic manifest, excluding its own digest field. */
export function reconciliationPayloadDigest(evidence: ReconciliationEvidence): string {
  return createHash("sha256").update(stableEvidencePayload(evidence)).digest("hex");
}

/** Bind review to both the manifest and exact reconciliation-only file content. */
export async function reconciliationReviewDigest(
  git: GitRepository,
  candidate: string,
  reconcile: string,
  evidence: ReconciliationEvidence,
): Promise<string> {
  const diff = await git.runBuffer(["diff", "--binary", "--no-color", "--no-ext-diff", "--no-renames", candidate, reconcile, "--"]);
  return createHash("sha256").update(stableEvidencePayload(evidence)).update("\0").update(diff).digest("hex");
}

export function isReconciliationPathAllowed(path: string): boolean {
  let normalized: string;
  try {
    normalized = normalizeRepoPath(path);
  } catch {
    return false;
  }
  return RECONCILIATION_ALLOWLIST.some((pattern) => matchesGlob(normalized, pattern));
}

function branchMatches(branch: string, pattern: string): boolean {
  try {
    return matchesGlob(branch, pattern);
  } catch {
    return false;
  }
}

async function exactCandidateIssues(
  git: GitRepository,
  from: string,
  mergedTree: string,
  config: MemoryConfig,
  dispositions: readonly ReconciliationDisposition[],
): Promise<{ changed: string[]; issues: MemoryIssue[] }> {
  const issues: MemoryIssue[] = [];
  const changed = (await git.changedPathsBetween(from, mergedTree)).filter((path) => isRelevantPath(path, config));
  const counts = new Map<string, number>();
  for (const disposition of dispositions) counts.set(disposition.path, (counts.get(disposition.path) ?? 0) + 1);

  for (const path of changed) {
    if (!counts.has(path)) issues.push(issue("missing-disposition", path, "Changed relevant path has no reconciliation disposition"));
  }
  for (const disposition of dispositions) {
    if (!changed.includes(disposition.path)) issues.push(issue("extraneous-disposition", disposition.path, "Disposition is not an exact changed relevant path"));
    if ((counts.get(disposition.path) ?? 0) > 1) issues.push(issue("duplicate-disposition", disposition.path, "Relevant path is dispositioned more than once"));
    const exists = await git.pathExists(mergedTree, disposition.path);
    if (disposition.outcome === "removed" && exists) issues.push(issue("invalid-removed-disposition", disposition.path, "Removed disposition still exists in the proposed merge tree"));
    if (disposition.outcome !== "removed" && !exists) issues.push(issue("missing-disposition-path", disposition.path, "Non-removed disposition does not exist in the proposed merge tree"));
    if ((disposition.outcome === "updated" || disposition.outcome === "confirmed") && disposition.concepts.length === 0) {
      issues.push(issue("unresolved-concept", disposition.path, "Semantic dispositions must name at least one concept"));
    }
  }
  return { changed, issues };
}

/**
 * Build and inspect evidence without mutating Git. All computations use resolved
 * object ids, so a concurrently moving named ref is observed as a stale target.
 */
export async function inspectReconciliationCandidate(
  cwd: string,
  config: MemoryConfig,
  request: ReconciliationRequest,
): Promise<CandidateValidation> {
  const git = new GitRepository(cwd);
  const issues: MemoryIssue[] = [];
  const [base, candidate, reconcile, target] = await Promise.all([
    git.resolveRef(request.state.watermark.revision),
    git.resolveRef(request.candidateRef),
    git.resolveRef(request.reconcileRef),
    git.resolveRef(request.targetRef),
  ]);

  if (base !== request.state.watermark.revision) issues.push(issue("noncanonical-base", "base", "Memory watermark must use a full commit id"));
  if (await canonicalCodeTreeDigest(git, base, config) !== request.state.watermark.digest) issues.push(issue("stale-generation-base", "base", "Published watermark digest does not match its revision"));
  if (request.state.generation < 0) issues.push(issue("invalid-generation", "generation", "Published generation cannot be negative"));
  if (!await git.isAncestor(candidate, reconcile)) issues.push(issue("reconcile-not-descendant", "candidate", "Reconciliation tip must descend from the immutable candidate snapshot"));
  if (!await git.isAncestor(target, candidate)) issues.push(issue("stale-or-divergent-target", "target", "Release target must be an ancestor of the candidate snapshot"));
  if (request.candidateBranch && !branchMatches(request.candidateBranch, config.reconciliationBranchPattern)) {
    issues.push(issue("invalid-reconciliation-branch", request.candidateBranch, `Branch does not match ${config.reconciliationBranchPattern}`));
  }
  if (request.unresolvedClaims === undefined) issues.push(issue("missing-claim-assessment", "claims", "Candidate must explicitly report unresolved claims"));
  else for (const claim of request.unresolvedClaims) issues.push(issue("unresolved-claim", claim, "Reconciliation has an unresolved or contradictory claim"));

  for (const path of await git.changedPathsBetween(candidate, reconcile)) {
    if (!isReconciliationPathAllowed(path)) issues.push(issue("forbidden-reconciliation-path", path, "Reconciliation-only commits changed a path outside the strict allowlist"));
  }

  let mergedTree = "";
  try {
    mergedTree = await git.mergedTree(target, reconcile);
  } catch (error) {
    issues.push(issue("unresolved-merge", "candidate", error instanceof Error ? error.message : String(error)));
  }

  let codeTreeDigest = "".padStart(64, "0");
  let changedRelevantPaths: string[] = [];
  if (mergedTree) {
    codeTreeDigest = await canonicalCodeTreeDigest(git, mergedTree, config);
    const exact = await exactCandidateIssues(git, base, mergedTree, config, request.dispositions);
    changedRelevantPaths = exact.changed;
    issues.push(...exact.issues);
  }

  const evidence: ReconciliationEvidence = {
    schemaVersion: 1,
    generation: request.state.generation + 1,
    base,
    candidate,
    target,
    codeTreeDigest,
    reviewDigest: request.reviewDigest ?? "".padStart(64, "0"),
    dispositions: [...request.dispositions].map((item) => ({ ...item, concepts: [...item.concepts] })),
  };
  const boundReviewDigest = await reconciliationReviewDigest(git, candidate, reconcile, evidence);
  if (request.reviewDigest === undefined) issues.push(issue("missing-review", "reviewDigest", `Independent review is required for digest ${boundReviewDigest}`));
  else if (request.reviewDigest !== boundReviewDigest) issues.push(issue("stale-review", "reviewDigest", `Independent review does not match digest ${boundReviewDigest}`));

  // Resolve again after all expensive work. A branch moving during inspection fails closed.
  const [candidateNow, targetNow] = await Promise.all([git.resolveRef(request.candidateRef), git.resolveRef(request.targetRef)]);
  if (candidateNow !== candidate) issues.push(issue("candidate-moved", "candidate", "Candidate ref moved during reconciliation"));
  if (targetNow !== target) issues.push(issue("target-moved", "target", "Release target moved during reconciliation"));
  return { evidence, reconcile, mergedTree, changedRelevantPaths, issues };
}

export async function assertReconciliationCandidate(cwd: string, config: MemoryConfig, request: ReconciliationRequest): Promise<ReconciliationEvidence> {
  const result = await inspectReconciliationCandidate(cwd, config, request);
  if (result.issues.length) throw new Error(result.issues.map((entry) => `${entry.code}: ${entry.path}`).join("; "));
  return result.evidence;
}

export interface ValidateEvidenceOptions {
  state: MemoryState;
  reconcileRef: string;
  currentTargetRef: string;
  expectedReviewDigest?: string;
  unresolvedClaims?: readonly string[];
}

/** Revalidate persisted evidence against current refs and the prior generation. */
export async function validateReconciliationEvidence(
  cwd: string,
  config: MemoryConfig,
  evidence: ReconciliationEvidence,
  options: ValidateEvidenceOptions,
): Promise<MemoryIssue[]> {
  const git = new GitRepository(cwd);
  const issues: MemoryIssue[] = [];
  if (evidence.generation !== options.state.generation + 1) issues.push(issue("concurrent-generation", "generation", "Generation is not the next published generation"));
  if (evidence.base !== options.state.watermark.revision) issues.push(issue("stale-generation-base", "base", "Evidence was based on a different published watermark"));
  const [target, reconcile] = await Promise.all([git.resolveRef(options.currentTargetRef), git.resolveRef(options.reconcileRef)]);
  if (target !== evidence.target) issues.push(issue("stale-target", "target", "Release target moved after reconciliation"));
  if (!await git.isAncestor(evidence.candidate, reconcile)) issues.push(issue("stale-candidate", "candidate", "Published reconcile tip does not contain the certified candidate"));
  for (const path of await git.changedPathsBetween(evidence.candidate, reconcile)) {
    if (!isReconciliationPathAllowed(path)) issues.push(issue("forbidden-reconciliation-path", path, "Certified candidate gained a non-memory change"));
  }
  try {
    const tree = await git.mergedTree(evidence.target, reconcile);
    if (await canonicalCodeTreeDigest(git, tree, config) !== evidence.codeTreeDigest) issues.push(issue("stale-code-tree", "codeTreeDigest", "Proposed merged relevant tree differs from evidence"));
    const exact = await exactCandidateIssues(git, evidence.base, tree, config, evidence.dispositions);
    issues.push(...exact.issues);
  } catch (error) {
    issues.push(issue("unresolved-merge", "candidate", error instanceof Error ? error.message : String(error)));
  }
  const boundReviewDigest = await reconciliationReviewDigest(git, evidence.candidate, reconcile, evidence);
  if (boundReviewDigest !== evidence.reviewDigest) issues.push(issue("stale-review", "reviewDigest", "Review is not bound to the current manifest and reconciliation content"));
  if (options.expectedReviewDigest !== undefined && options.expectedReviewDigest !== evidence.reviewDigest) issues.push(issue("stale-review", "reviewDigest", "Independent review does not match the evidence"));
  if (options.unresolvedClaims === undefined) issues.push(issue("missing-claim-assessment", "claims", "Validation must explicitly report unresolved claims"));
  else for (const claim of options.unresolvedClaims) issues.push(issue("unresolved-claim", claim, "Reconciliation has an unresolved or contradictory claim"));
  return issues;
}

/** Publication must be a two-parent merge with target first and the reconcile tip second. */
export async function validatePublicationMerge(
  cwd: string,
  config: MemoryConfig,
  evidence: ReconciliationEvidence,
  publicationRef: string,
  reconcileRef: string,
): Promise<PublicationValidation> {
  const git = new GitRepository(cwd);
  const issues: MemoryIssue[] = [];
  const [publication, reconcile] = await Promise.all([git.resolveRef(publicationRef), git.resolveRef(reconcileRef)]);
  const parents = await git.parents(publication);
  if (parents.length !== 2) issues.push(issue("publication-not-merge", publication, "Publication must be a real two-parent merge commit"));
  else {
    if (parents[0] !== evidence.target) issues.push(issue("publication-first-parent", publication, "Publication first parent is not the certified release target"));
    if (parents[1] !== reconcile) issues.push(issue("publication-second-parent", publication, "Publication second parent is not the reconciliation tip"));
  }
  if (!await git.isAncestor(evidence.candidate, reconcile)) issues.push(issue("publication-missing-candidate", publication, "Reconciliation tip does not contain the certified candidate"));
  for (const path of await git.changedPathsBetween(evidence.candidate, reconcile)) {
    if (!isReconciliationPathAllowed(path)) issues.push(issue("forbidden-reconciliation-path", path, "Published reconcile tip contains a non-memory change"));
  }
  if (await reconciliationReviewDigest(git, evidence.candidate, reconcile, evidence) !== evidence.reviewDigest) issues.push(issue("stale-review", "reviewDigest", "Publication content was not independently reviewed"));
  if (await canonicalCodeTreeDigest(git, publication, config) !== evidence.codeTreeDigest) issues.push(issue("publication-tree-mismatch", publication, "Final merged relevant tree differs from reviewed evidence"));
  try {
    const proposedTree = await git.mergedTree(evidence.target, reconcile);
    if (await git.treeId(publication) !== proposedTree) issues.push(issue("publication-final-tree-mismatch", publication, "Final merged tree contains unreviewed conflict resolution or other content"));
  } catch (error) {
    issues.push(issue("unresolved-merge", publication, error instanceof Error ? error.message : String(error)));
  }
  return { publication, reconcile, issues };
}

/**
 * Back-sync is idempotent once publication is already contained. Otherwise it
 * must be a real merge preserving the pre-sync integration relevant tree.
 */
export async function validateBackSyncMerge(
  cwd: string,
  config: MemoryConfig,
  publicationRef: string,
  integrationBeforeRef: string,
  backSyncRef: string,
): Promise<BackSyncValidation> {
  const git = new GitRepository(cwd);
  const [publication, integrationBefore, backSync] = await Promise.all([
    git.resolveRef(publicationRef), git.resolveRef(integrationBeforeRef), git.resolveRef(backSyncRef),
  ]);
  if (await git.isAncestor(publication, integrationBefore)) return { status: "already-synchronized", issues: [] };
  const issues: MemoryIssue[] = [];
  const parents = await git.parents(backSync);
  if (parents.length !== 2) issues.push(issue("back-sync-not-merge", backSync, "Back-sync must be a real two-parent merge commit"));
  else {
    if (parents[0] !== integrationBefore) issues.push(issue("back-sync-first-parent", backSync, "Back-sync first parent is not the integration tip"));
    if (parents[1] !== publication) issues.push(issue("back-sync-second-parent", backSync, "Back-sync second parent is not the publication merge"));
  }
  const beforeDigest = await canonicalCodeTreeDigest(git, integrationBefore, config);
  if (await canonicalCodeTreeDigest(git, backSync, config) !== beforeDigest) issues.push(issue("back-sync-tree-mismatch", backSync, "Back-sync changed relevant integration content, including via conflict resolution"));
  try {
    const proposedTree = await git.mergedTree(integrationBefore, publication);
    if (await git.treeId(backSync) !== proposedTree) issues.push(issue("back-sync-final-tree-mismatch", backSync, "Back-sync contains an unexpected conflict resolution or other content"));
  } catch (error) {
    issues.push(issue("unresolved-merge", backSync, error instanceof Error ? error.message : String(error)));
  }
  return { status: "merged", issues };
}
