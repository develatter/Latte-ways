import { createHash } from "node:crypto";
import { lstat, readFile, readdir, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { effectiveMemoryConfig, loadConfig } from "../config/config.js";
import { KNOWLEDGE_DIR, MEMORY_DIR } from "../domain/constants.js";
import type { ReviewResult } from "../domain/types.js";
import { validateReview, validationDetails } from "../domain/validation.js";
import { stableJson, writeAtomic } from "../fs/files.js";
import { GitRepository } from "../git/git.js";
import { inspectOkf } from "../knowledge/okf.js";
import { loadState } from "../state/store.js";
import { reviewBlocks } from "../work/review.js";
import { canonicalCodeTreeDigest } from "./digest.js";
import type { MemoryState } from "./model.js";
import { inspectCoverage } from "./validation.js";

export const DISCOVERY_PATH = `${MEMORY_DIR}/discovery.json`;
export const MEMORY_STATE_PATH = `${KNOWLEDGE_DIR}/state.json`;
export const SEMANTIC_REVIEW_DIR = `${MEMORY_DIR}/reviews`;

export interface DiscoveryRequest {
  schemaVersion: 1;
  kind: "bootstrap" | "rediscovery";
  status: "review-required";
  requestedAt: string;
}

export interface ImplementationRange {
  from: string;
  to: string;
}

function hashParts(parts: readonly (string | Buffer)[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    const value = Buffer.isBuffer(part) ? part : Buffer.from(part, "utf8");
    hash.update(`${value.length}\0`);
    hash.update(value);
  }
  return hash.digest("hex");
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function readDiscovery(cwd: string): Promise<DiscoveryRequest | undefined> {
  try {
    const value = JSON.parse(await readFile(join(cwd, DISCOVERY_PATH), "utf8")) as Partial<DiscoveryRequest>;
    if (value.schemaVersion !== 1 || !["bootstrap", "rediscovery"].includes(value.kind ?? "") || value.status !== "review-required" || typeof value.requestedAt !== "string") {
      throw new Error(`Invalid discovery request at ${DISCOVERY_PATH}`);
    }
    return value as DiscoveryRequest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Leave an explicit, durable discovery requirement. Re-running interrupted
 * bootstrap is idempotent; rediscovery can only be initiated explicitly.
 */
export async function requestDiscovery(cwd: string, rediscovery = false): Promise<DiscoveryRequest> {
  const pending = await readDiscovery(cwd);
  if (pending) {
    if (rediscovery && pending.kind !== "rediscovery") throw new Error("Bootstrap discovery is already pending");
    return pending;
  }
  const hasBaseline = await exists(join(cwd, MEMORY_STATE_PATH));
  if (hasBaseline && !rediscovery) throw new Error("A memory baseline already exists; full rediscovery must be explicitly requested");
  if (!hasBaseline && rediscovery) throw new Error("Cannot rediscover before the bootstrap discovery baseline exists");
  const request: DiscoveryRequest = {
    schemaVersion: 1,
    kind: rediscovery ? "rediscovery" : "bootstrap",
    status: "review-required",
    requestedAt: new Date().toISOString(),
  };
  await writeAtomic(join(cwd, DISCOVERY_PATH), stableJson(request));
  return request;
}

async function filesBelow(root: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) result.push(path);
    }
  }
  try {
    await walk(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return result.sort();
}

async function knowledgeSnapshot(cwd: string): Promise<Array<string | Buffer>> {
  const root = join(cwd, KNOWLEDGE_DIR);
  const parts: Array<string | Buffer> = [];
  for (const path of await filesBelow(root)) {
    const name = relative(root, path).replaceAll("\\", "/");
    const stat = await lstat(path);
    parts.push(name, (stat.mode & 0o111) === 0 ? "100644" : "100755", await readFile(path));
  }
  return parts;
}

async function assertSemanticMemoryValid(cwd: string, ref: string): Promise<void> {
  const config = effectiveMemoryConfig(await loadConfig(cwd));
  const okf = await inspectOkf(cwd);
  const coverage = await inspectCoverage(cwd, config, ref);
  const issues = [...okf.issues, ...coverage.issues];
  if (issues.length > 0) throw new Error(issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
}

/** Digest independently reviewed for initial discovery or an explicit rediscovery. */
export async function discoveryReviewDigest(cwd: string): Promise<string> {
  const request = await readDiscovery(cwd);
  if (!request) throw new Error("No discovery is pending; rediscovery is never implicit");
  const git = new GitRepository(cwd);
  const revision = await git.head();
  await assertSemanticMemoryValid(cwd, revision);
  const config = effectiveMemoryConfig(await loadConfig(cwd));
  const codeTreeDigest = await canonicalCodeTreeDigest(git, revision, config);
  return hashParts(["ways-memory-discovery-v1", request.kind, revision, codeTreeDigest, ...await knowledgeSnapshot(cwd)]);
}

async function acceptedReview(reviewPath: string, digest: string, expectedWorkIds: readonly string[]): Promise<ReviewResult> {
  const value: unknown = JSON.parse(await readFile(reviewPath, "utf8"));
  if (!validateReview(value)) throw new Error(`Invalid semantic review: ${validationDetails("review", value).errors.join("; ")}`);
  if (!value.reviewer.trim()) throw new Error("Independent reviewer identity is required");
  if (!expectedWorkIds.includes(value.workId)) throw new Error(`Semantic review work id must be ${expectedWorkIds.join(" or ")}`);
  if (value.digest !== digest) throw new Error("Semantic review is stale: memory content or its reviewed code changed");
  const blockers = reviewBlocks(value);
  if (blockers.length > 0) throw new Error(`Semantic review blocked by: ${blockers.join(", ")}`);
  return value;
}

/** Establish the reviewed watermark. A greenfield baseline may contain no concepts. */
export async function completeDiscovery(cwd: string, reviewPath: string): Promise<MemoryState> {
  const request = await readDiscovery(cwd);
  if (!request) throw new Error("No discovery is pending");
  const digest = await discoveryReviewDigest(cwd);
  const review = await acceptedReview(reviewPath, digest, ["memory-discovery", request.kind]);
  const git = new GitRepository(cwd);
  const revision = await git.head();
  const config = effectiveMemoryConfig(await loadConfig(cwd));
  let generation = 0;
  try {
    const previous = JSON.parse(await readFile(join(cwd, MEMORY_STATE_PATH), "utf8")) as Partial<MemoryState>;
    generation = typeof previous.generation === "number" ? previous.generation + 1 : 0;
  } catch {
    // Initial bootstrap has no state.
  }
  const state: MemoryState = {
    schemaVersion: 1,
    generation,
    watermark: {
      revision,
      digest: await canonicalCodeTreeDigest(git, revision, config),
      reviewDigest: review.digest,
    },
  };
  await writeAtomic(join(cwd, MEMORY_STATE_PATH), stableJson(state));
  await writeAtomic(join(cwd, SEMANTIC_REVIEW_DIR, `${review.digest}.json`), stableJson({
    schemaVersion: 1,
    kind: request.kind,
    review,
    watermark: state.watermark,
  }));
  await rm(join(cwd, DISCOVERY_PATH), { force: true });
  return state;
}

export async function resolveImplementationRange(cwd: string, range: string): Promise<ImplementationRange> {
  const match = range.match(/^([^.^~\s]+)\.\.([^\s]+)$/);
  if (!match?.[1] || !match[2]) throw new Error("Implementation range must use <from>..<to>");
  const git = new GitRepository(cwd);
  const from = await git.resolveRef(match[1]);
  const to = await git.resolveRef(match[2]);
  if (from === to || !await git.isAncestor(from, to)) throw new Error("Implementation range must be a non-empty ancestry range");
  if (!await git.isAncestor(to, "HEAD")) throw new Error("Implementation range end must be contained in HEAD");
  return { from, to };
}

function isKnowledgePath(path: string): boolean {
  return path === KNOWLEDGE_DIR || path.startsWith(`${KNOWLEDGE_DIR}/`);
}

function isHarnessBookkeeping(path: string): boolean {
  return path === ".ways/status.json"
    || path.startsWith(".ways/state/")
    || path.startsWith(".ways/sdd/")
    || path.startsWith(".ways/runtime/")
    || path.startsWith(".ways/indexes/");
}

async function memoryChanges(cwd: string, ignoredPaths: readonly string[] = []): Promise<string[]> {
  const git = new GitRepository(cwd);
  const changed = await git.changedPaths();
  const ignored = new Set(ignoredPaths);
  const forbidden = changed.filter((path) => !isKnowledgePath(path) && !isHarnessBookkeeping(path) && !ignored.has(path));
  if (forbidden.length > 0) throw new Error(`Memory commit requires implementation changes to be committed first; unrelated changes: ${forbidden.join(", ")}`);
  const paths = changed.filter(isKnowledgePath);
  if (paths.length === 0) throw new Error("No authored memory changes to commit");
  return paths;
}

/** Digest binding authored memory to the exact motivating implementation range. */
export async function memoryCommitReviewDigest(cwd: string, implementationRange: string, ignoredPaths: readonly string[] = []): Promise<string> {
  const range = await resolveImplementationRange(cwd, implementationRange);
  const paths = await memoryChanges(cwd, ignoredPaths);
  await assertSemanticMemoryValid(cwd, range.to);
  const git = new GitRepository(cwd);
  const config = effectiveMemoryConfig(await loadConfig(cwd));
  const diff = await git.runBuffer(["diff", "--binary", "--no-color", "HEAD", "--", KNOWLEDGE_DIR]);
  const untracked = new Set((await git.run(["ls-files", "--others", "--exclude-standard", "--", KNOWLEDGE_DIR])).split("\n").filter(Boolean));
  const untrackedParts: Array<string | Buffer> = [];
  for (const path of paths.filter((path) => untracked.has(path)).sort()) untrackedParts.push(path, await readFile(join(cwd, path)));
  return hashParts([
    "ways-memory-commit-v1",
    range.from,
    range.to,
    await canonicalCodeTreeDigest(git, range.to, config),
    diff,
    ...untrackedParts,
  ]);
}

/** Create a separate traced commit; derived indexes are deliberately ignored. */
export async function commitMemory(cwd: string, implementationRange: string, reviewPath: string, subject: string): Promise<string> {
  if (!subject.trim()) throw new Error("A concise memory commit subject is required");
  if (!await exists(join(cwd, MEMORY_STATE_PATH)) || await readDiscovery(cwd)) throw new Error("Complete the reviewed discovery baseline before incremental memory commits");
  const work = await loadState(cwd);
  if (!work || work.status !== "active") throw new Error("Memory commits require active work");
  const range = await resolveImplementationRange(cwd, implementationRange);
  const relativeReview = relative(resolve(cwd), resolve(reviewPath)).replaceAll("\\", "/");
  const ignored = relativeReview.startsWith("../") ? [] : [relativeReview];
  const digest = await memoryCommitReviewDigest(cwd, implementationRange, ignored);
  const review = await acceptedReview(reviewPath, digest, [work.id]);
  const paths = await memoryChanges(cwd, ignored);
  const evidencePath = `${SEMANTIC_REVIEW_DIR}/${review.digest}.json`;
  await writeAtomic(join(cwd, evidencePath), stableJson({
    schemaVersion: 1,
    kind: "incremental",
    implementation: range,
    review,
  }));
  const git = new GitRepository(cwd);
  return git.commit([...paths, evidencePath], subject.trim(), {
    work: work.id,
    implementation: `${range.from}..${range.to}`,
    memoryReviewDigest: review.digest,
  });
}
