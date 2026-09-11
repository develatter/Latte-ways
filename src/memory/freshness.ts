import type { MemoryConfig } from "../domain/types.js";
import { GitRepository } from "../git/git.js";
import { canonicalCodeTreeDigest, isRelevantPath } from "./digest.js";
import { matchesAny } from "./glob.js";
import type { MemoryState } from "./model.js";
import { inspectCoverage } from "./validation.js";

export interface MemoryFreshness {
  current: boolean;
  revision: string;
  digest: string;
  changedPaths: string[];
  affectedAreas: string[];
  warnings: string[];
}

/** Content-based freshness: transported commits do not create drift, changed relevant trees do. */
export async function inspectMemoryFreshness(
  cwd: string,
  config: MemoryConfig,
  state: MemoryState,
  ref = "HEAD",
): Promise<MemoryFreshness> {
  const git = new GitRepository(cwd);
  const revision = await git.resolveRef(ref);
  const digest = await canonicalCodeTreeDigest(git, revision, config);
  if (digest === state.watermark.digest) return { current: true, revision, digest, changedPaths: [], affectedAreas: [], warnings: [] };

  const changedPaths = (await git.changedPathsBetween(state.watermark.revision, revision))
    .filter((path) => isRelevantPath(path, config));
  const { areas } = await inspectCoverage(cwd, config, revision);
  const affectedAreas = areas
    .filter((area) => changedPaths.some((path) => matchesAny(path, area.globs)))
    .map((area) => area.id)
    .sort();
  const detail = affectedAreas.length ? ` Potentially affected areas: ${affectedAreas.join(", ")}.` : "";
  return {
    current: false,
    revision,
    digest,
    changedPaths,
    affectedAreas,
    warnings: [`Memory may be stale: the relevant code tree differs from generation ${state.generation}.${detail}`],
  };
}
