import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { MemoryConfig } from "../domain/types.js";
import { validationDetails, validateCoverage } from "../domain/validation.js";
import { GitRepository } from "../git/git.js";
import type { OkfDocument } from "../knowledge/okf.js";
import { matchesAny, matchesGlob, normalizeGlob, normalizeRepoPath } from "./glob.js";
import { canonicalCodeTreeDigest, isRelevantPath } from "./digest.js";
import type { CoverageArea, MemoryIssue, MemorySource, MemoryState } from "./model.js";

const COVERAGE_DIR = ".ways/knowledge/coverage";
const GLOB_MARKERS = /[*?]/;

function localResource(resource: string): string | undefined {
  if (!resource.startsWith("/") || resource.startsWith("//")) return undefined;
  return resource.slice(1);
}

export async function validateSources(cwd: string, documents: readonly OkfDocument[], ref = "HEAD"): Promise<MemoryIssue[]> {
  const issues: MemoryIssue[] = [];
  const git = new GitRepository(cwd);
  const pathsByRef = new Map<string, string[]>();
  async function pathsAt(sourceRef: string): Promise<string[]> {
    const cached = pathsByRef.get(sourceRef);
    if (cached) return cached;
    const paths = (await git.treeEntries(sourceRef)).map((entry) => entry.path);
    pathsByRef.set(sourceRef, paths);
    return paths;
  }
  for (const document of documents) {
    const value = document.frontmatter.sources;
    if (value === undefined || !Array.isArray(value)) continue;
    for (const [index, item] of value.entries()) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const source = item as unknown as MemorySource;
      if (typeof source.resource !== "string") continue;
      const local = localResource(source.resource);
      if (local === undefined) continue;
      const issuePath = `${document.path}#sources[${index}]`;
      let normalized: string;
      try {
        normalized = source.kind === "glob" || GLOB_MARKERS.test(local) ? normalizeGlob(local) : normalizeRepoPath(local);
      } catch (error) {
        issues.push({ code: "invalid-source-path", path: issuePath, message: error instanceof Error ? error.message : String(error) });
        continue;
      }
      if (source.revision !== undefined && !/^[a-f0-9]{40,64}$/.test(source.revision)) {
        issues.push({ code: "invalid-source-revision", path: issuePath, message: "Source revision must be a full object id" });
        continue;
      }
      const sourceRef = source.revision ?? ref;
      let reviewedPaths: string[];
      let currentPaths: string[];
      try {
        reviewedPaths = await pathsAt(sourceRef);
      } catch {
        issues.push({ code: "missing-source-revision", path: issuePath, message: `Source revision does not resolve: ${sourceRef}` });
        continue;
      }
      try {
        currentPaths = sourceRef === ref ? reviewedPaths : await pathsAt(ref);
      } catch {
        issues.push({ code: "missing-source-revision", path: issuePath, message: `Current source revision does not resolve: ${ref}` });
        continue;
      }
      const isGlob = source.kind === "glob" || GLOB_MARKERS.test(normalized);
      const resolves = (paths: readonly string[]): boolean => isGlob
        ? paths.some((path) => matchesGlob(path, normalized))
        : paths.includes(normalized) || paths.some((path) => path.startsWith(`${normalized}/`));
      if (!resolves(reviewedPaths)) issues.push({ code: isGlob ? "empty-source-glob" : "missing-source", path: issuePath, message: `Local source does not resolve at ${sourceRef}: /${normalized}` });
      else if (!resolves(currentPaths)) issues.push({ code: isGlob ? "empty-source-glob" : "missing-source", path: issuePath, message: `Active local source no longer resolves at ${ref}: /${normalized}` });
    }
  }
  return issues;
}

async function coverageFiles(cwd: string): Promise<string[]> {
  const root = join(cwd, COVERAGE_DIR);
  const found: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith(".json")) found.push(path);
    }
  }
  try {
    await walk(root);
    return found.sort();
  } catch {
    return [];
  }
}

export async function inspectCoverage(cwd: string, config: MemoryConfig, ref = "HEAD"): Promise<{ areas: CoverageArea[]; issues: MemoryIssue[] }> {
  const areas: CoverageArea[] = [];
  const issues: MemoryIssue[] = [];
  const ids = new Set<string>();
  for (const path of await coverageFiles(cwd)) {
    const display = relative(cwd, path).replaceAll("\\", "/");
    let value: unknown;
    try {
      value = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      issues.push({ code: "coverage-json", path: display, message: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (!validateCoverage(value)) {
      issues.push({ code: "coverage-schema", path: display, message: validationDetails("coverage", value).errors.join("; ") });
      continue;
    }
    if (ids.has(value.id)) issues.push({ code: "duplicate-coverage-area", path: display, message: `Duplicate coverage id: ${value.id}` });
    ids.add(value.id);
    for (const glob of value.globs) {
      try {
        normalizeGlob(glob);
      } catch (error) {
        issues.push({ code: "invalid-coverage-glob", path: display, message: error instanceof Error ? error.message : String(error) });
      }
    }
    areas.push(value);
  }

  const git = new GitRepository(cwd);
  const documents = (await import("../knowledge/okf.js")).inspectOkf;
  const conceptIds = new Set((await documents(cwd, { validateSources: false })).documents
    .filter((document) => document.frontmatter.status !== "deprecated" && !document.path.startsWith("deprecated/"))
    .map((document) => document.id));
  for (const area of areas) {
    for (const concept of area.concepts) {
      if (!conceptIds.has(concept)) issues.push({ code: "missing-coverage-concept", path: area.id, message: `Coverage references missing concept: ${concept}` });
    }
  }

  for (const entry of await git.treeEntries(ref)) {
    if (!isRelevantPath(entry.path, config)) continue;
    const matching = areas.filter((area) => matchesAny(entry.path, area.globs));
    if (matching.length === 0) issues.push({ code: "uncovered-relevant-path", path: entry.path, message: "Relevant path has no coverage area" });
    if (matching.length > 1) issues.push({ code: "overlapping-coverage", path: entry.path, message: `Relevant path belongs to multiple areas: ${matching.map((area) => area.id).join(", ")}` });
  }
  return { areas, issues };
}

export async function validateWatermark(cwd: string, state: MemoryState, config: MemoryConfig): Promise<MemoryIssue[]> {
  const issues: MemoryIssue[] = [];
  const git = new GitRepository(cwd);
  try {
    const revision = await git.resolveRef(state.watermark.revision);
    if (revision !== state.watermark.revision) issues.push({ code: "noncanonical-watermark-revision", path: ".ways/knowledge/state.json", message: "Watermark revision must be a full commit id" });
    const digest = await canonicalCodeTreeDigest(git, revision, config);
    if (digest !== state.watermark.digest) issues.push({ code: "stale-watermark", path: ".ways/knowledge/state.json", message: "Watermark digest does not match its reviewed revision" });
  } catch (error) {
    issues.push({ code: "missing-watermark-revision", path: ".ways/knowledge/state.json", message: error instanceof Error ? error.message : String(error) });
  }
  return issues;
}

/** Resolve a current path without following it; useful for pre-commit source checks. */
export async function localSourceExists(cwd: string, path: string): Promise<boolean> {
  try {
    await lstat(join(cwd, normalizeRepoPath(path)));
    return true;
  } catch {
    return false;
  }
}
