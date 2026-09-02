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

  it("exposes exact tree and commit topology primitives", async () => {
    const initial = await git.head();
    const entries = await git.treeEntries(initial);
    expect(entries.map((entry) => entry.path)).toEqual(["README.md"]);
    expect((await git.objectBytes(entries[0]!.object)).toString()).toBe("initial\n");
    expect(await git.resolveRef("HEAD")).toBe(initial);
    expect(await git.parents()).toHaveLength(0);

    await writeFile(join(cwd, "README.md"), "changed\n");
    await git.run(["add", "."]);
    await git.run(["commit", "-q", "-m", "change"]);
    expect(await git.parents()).toEqual([initial]);
    expect(await git.changedPathsBetween(initial, "HEAD")).toEqual(["README.md"]);
    expect(await git.mergeBase(initial, "HEAD")).toBe(initial);
    expect(await git.isMergeCommit()).toBe(false);
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
  it("round trips metadata", () => {
    const text = formatTrailers({ work: "x", phase: "plan", state: "completed", task: "api" });
    expect(parseTrailers(text)).toEqual({ work: "x", phase: "plan", state: "completed", task: "api" });
  });
});
