import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SDD_DIR, STATE_PATH, STATUS_PATH } from "../domain/constants.js";
import { GitRepository } from "../git/git.js";

/** Paths the harness rewrites on its own; they never count as reviewed or approved content. */
const BOOKKEEPING = [STATUS_PATH, `${STATE_PATH}`];

function isBookkeeping(path: string): boolean {
  if (BOOKKEEPING.includes(path)) return true;
  return new RegExp(`^${SDD_DIR}/[^/]+/(approvals|reviews)/`).test(path);
}

/**
 * Digest of everything that changed since `since`: the tracked diff against the
 * working tree plus every untracked file. Bookkeeping paths are excluded so the
 * digest survives the harness's own state updates but dies on any content edit.
 */
export async function workDigest(cwd: string, since: string): Promise<string> {
  const git = new GitRepository(cwd);
  const exclude = [`:(exclude)${STATUS_PATH}`, `:(exclude)${STATE_PATH}`, `:(exclude,glob)${SDD_DIR}/*/approvals/**`, `:(exclude,glob)${SDD_DIR}/*/reviews/**`];
  const hash = createHash("sha256");
  hash.update(await git.run(["diff", "--binary", "--no-color", "--no-ext-diff", since, "--", ".", ...exclude]));
  const untracked = (await git.run(["ls-files", "--others", "--exclude-standard"])).split("\n").filter((path) => path && !isBookkeeping(path)).sort();
  for (const path of untracked) {
    hash.update(`\0${path}\0`);
    hash.update(await readFile(join(cwd, path)));
  }
  return hash.digest("hex");
}
