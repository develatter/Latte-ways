import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CommitTrailers {
  work?: string;
  phase?: string;
  state?: string;
  task?: string;
}

export interface CommitInfo {
  hash: string;
  subject: string;
  body: string;
  trailers: CommitTrailers;
}

export class GitError extends Error {
  constructor(message: string, readonly stderr = "") {
    super(message);
    this.name = "GitError";
  }
}

export class GitRepository {
  constructor(readonly cwd: string) {}

  async run(args: readonly string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync("git", [...args], {
        cwd: this.cwd,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout.trimEnd();
    } catch (error) {
      const failure = error as { message?: string; stderr?: string };
      throw new GitError(failure.message ?? `git ${args.join(" ")} failed`, failure.stderr ?? "");
    }
  }

  async root(): Promise<string> {
    return this.run(["rev-parse", "--show-toplevel"]);
  }

  async head(): Promise<string> {
    return this.run(["rev-parse", "HEAD"]);
  }

  async parent(commit = "HEAD"): Promise<string> {
    return this.run(["rev-parse", `${commit}^`]);
  }

  async status(): Promise<string[]> {
    const output = await this.run(["status", "--porcelain=v1"]);
    return output ? output.split("\n") : [];
  }

  async changedPaths(): Promise<string[]> {
    const output = await this.run(["ls-files", "--modified", "--deleted", "--others", "--exclude-standard"]);
    return output ? [...new Set(output.split("\n").filter(Boolean))].sort() : [];
  }

  async assertClean(): Promise<void> {
    const changes = await this.status();
    if (changes.length > 0) {
      throw new GitError(`Worktree is not clean:\n${changes.join("\n")}`);
    }
  }

  async commitInfo(ref = "HEAD"): Promise<CommitInfo> {
    const output = await this.run(["show", "-s", "--format=%H%x00%s%x00%b", ref]);
    const [hash = "", subject = "", body = ""] = output.split("\0");
    return { hash, subject, body, trailers: parseTrailers(body) };
  }

  async lastCommit(): Promise<CommitInfo> {
    return this.commitInfo("HEAD");
  }

  async isAncestor(ancestor: string, descendant = "HEAD"): Promise<boolean> {
    try {
      await this.run(["merge-base", "--is-ancestor", ancestor, descendant]);
      return true;
    } catch {
      return false;
    }
  }

  async findCertification(work: string, phase: string): Promise<CommitInfo | undefined> {
    const hashes = (await this.run(["log", "-100", "--format=%H"])).split("\n").filter(Boolean);
    for (const hash of hashes) {
      const info = await this.commitInfo(hash);
      if (info.trailers.work === work && info.trailers.phase === phase && info.trailers.state === "completed") return info;
    }
    return undefined;
  }

  async commit(paths: readonly string[], subject: string, trailers: CommitTrailers): Promise<string> {
    if (paths.length === 0) throw new GitError("Refusing to commit without explicit paths");
    await this.run(["add", "--", ...paths]);

    try {
      await this.run(["diff", "--cached", "--quiet"]);
      throw new GitError("Refusing to create an empty commit");
    } catch (error) {
      if (error instanceof GitError && error.message === "Refusing to create an empty commit") throw error;
    }

    const trailerBody = formatTrailers(trailers);
    const args = ["commit", "-m", subject];
    if (trailerBody) args.push("-m", trailerBody);
    await this.run(args);
    return this.head();
  }
}

export function parseTrailers(body: string): CommitTrailers {
  const result: CommitTrailers = {};
  const names: Record<string, keyof CommitTrailers> = {
    "Harness-Work": "work",
    "Harness-Phase": "phase",
    "Harness-State": "state",
    "Harness-Task": "task",
  };

  for (const line of body.split("\n")) {
    const match = line.match(/^([A-Za-z-]+):\s*(.+)$/);
    if (!match) continue;
    const key = match[1] ? names[match[1]] : undefined;
    const value = match[2]?.trim();
    if (key && value) result[key] = value;
  }
  return result;
}

export function formatTrailers(trailers: CommitTrailers): string {
  const entries: Array<[string, string | undefined]> = [
    ["Harness-Work", trailers.work],
    ["Harness-Phase", trailers.phase],
    ["Harness-State", trailers.state],
    ["Harness-Task", trailers.task],
  ];
  return entries.filter((entry): entry is [string, string] => Boolean(entry[1])).map(([key, value]) => `${key}: ${value}`).join("\n");
}
