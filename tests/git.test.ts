import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { GitError, GitRepository, formatTrailers, parseTrailers } from "../src/git/git.js";

let cwd: string;
let git: GitRepository;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "ways-git-"));
  git = new GitRepository(cwd);
  await git.run(["init", "-q"]);
  await git.run(["config", "user.name", "Ways Test"]);
  await git.run(["config", "user.email", "ways@example.test"]);
  await writeFile(join(cwd, "README.md"), "initial\n");
  await git.run(["add", "README.md"]);
  await git.run(["commit", "-q", "-m", "initial"]);
});

describe("GitRepository", () => {
  it("rejects a dirty worktree", async () => {
    await writeFile(join(cwd, "README.md"), "changed\n");
    await expect(git.assertClean()).rejects.toBeInstanceOf(GitError);
  });

  it("creates and reads a commit with canonical trailers", async () => {
    await writeFile(join(cwd, "work.txt"), "done\n");
    await git.commit(["work.txt"], "feat: complete exploration", {
      work: "auth-refresh",
      phase: "explore",
      state: "completed",
    });
    const commit = await git.lastCommit();
    expect(commit.subject).toBe("feat: complete exploration");
    expect(commit.trailers).toEqual({ work: "auth-refresh", phase: "explore", state: "completed" });
  });
});

describe("trailers", () => {
  it("round trips metadata including remediation attempts", () => {
    const text = formatTrailers({ work: "x", phase: "plan", state: "completed", task: "api", attempt: "1" });
    expect(parseTrailers(text)).toEqual({ work: "x", phase: "plan", state: "completed", task: "api", attempt: "1" });
  });
});
