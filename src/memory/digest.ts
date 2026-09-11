import { createHash } from "node:crypto";
import type { MemoryConfig } from "../domain/types.js";
import { GitRepository, type GitTreeEntry } from "../git/git.js";
import { matchesAny, normalizeRepoPath } from "./glob.js";

const ALWAYS_EXCLUDED = [
  ".ways/knowledge/**",
  ".ways/indexes/**",
  ".ways/memory/**",
  ".ways/reconciliation/**",
  ".ways/reconciliations/**",
];

export function isRelevantPath(path: string, config: MemoryConfig): boolean {
  const normalized = normalizeRepoPath(path);
  return matchesAny(normalized, config.relevantPaths)
    && !matchesAny(normalized, [...ALWAYS_EXCLUDED, ...config.excludedPaths]);
}

export async function relevantTreeEntries(git: GitRepository, ref: string, config: MemoryConfig): Promise<GitTreeEntry[]> {
  return (await git.treeEntries(ref)).filter((entry) => isRelevantPath(entry.path, config));
}

/**
 * Hash a tree's relevant path, Git mode/type and exact object bytes. Commit
 * identity, timestamps and traversal environment never enter the digest.
 */
export async function canonicalCodeTreeDigest(git: GitRepository, ref: string, config: MemoryConfig): Promise<string> {
  const hash = createHash("sha256");
  for (const entry of await relevantTreeEntries(git, ref, config)) {
    const bytes = entry.type === "commit" ? Buffer.from(entry.object, "ascii") : await git.objectBytes(entry.object);
    const header = Buffer.from(`${Buffer.byteLength(entry.path)}\0${entry.path}\0${entry.mode}\0${entry.type}\0${bytes.length}\0`, "utf8");
    hash.update(header);
    hash.update(bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
}
