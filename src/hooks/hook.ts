import { readFile } from "node:fs/promises";
import { MANIFEST_PATH, STATE_PATH } from "../domain/constants.js";
import type { WorkState } from "../domain/types.js";
import { validateState } from "../domain/validation.js";
import { GitRepository, parseTrailers } from "../git/git.js";
import { loadState } from "../state/store.js";

export interface HookVerdict {
  accepted: boolean;
  reason: string;
}

const CLOSING_STATES = new Set(["completed", "cancelled"]);

async function headState(git: GitRepository): Promise<WorkState | undefined> {
  try {
    const value: unknown = JSON.parse(await git.run(["show", `HEAD:${STATE_PATH}`]));
    return validateState(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

async function headHasManifest(git: GitRepository): Promise<boolean> {
  try {
    await git.run(["cat-file", "-e", `HEAD:${MANIFEST_PATH}`]);
    return true;
  } catch {
    return false;
  }
}

export async function judgeCommitMessage(cwd: string, message: string): Promise<HookVerdict> {
  const trailers = parseTrailers(message);
  const git = new GitRepository(cwd);

  const active = await loadState(cwd);
  if (active) {
    if (trailers.work === active.id) return { accepted: true, reason: `Commit traced to active ${active.mode} work ${active.id}` };
    return { accepted: false, reason: `Active ${active.mode} work is ${active.id}; commit through the harness so it carries Harness-Work: ${active.id}` };
  }

  const closing = await headState(git);
  if (closing) {
    if (trailers.work === closing.id && trailers.state && CLOSING_STATES.has(trailers.state)) {
      return { accepted: true, reason: `Closing commit for ${closing.id}` };
    }
    return { accepted: false, reason: `HEAD still records work ${closing.id}; only its closing commit may follow. Run ways repair diagnose` };
  }

  if (!await headHasManifest(git)) return { accepted: true, reason: "Bootstrap commit accepted" };
  return { accepted: false, reason: "No active work. Open one first, for example: ways quick start <id>" };
}

export async function runCommitMsgHook(cwd: string, messagePath: string): Promise<HookVerdict> {
  const raw = await readFile(messagePath, "utf8");
  const message = raw.split("\n").filter((line) => !line.startsWith("#")).join("\n");
  return judgeCommitMessage(cwd, message);
}
