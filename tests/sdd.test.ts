import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bootstrap } from "../src/bootstrap/bootstrap.js";
import { GitRepository } from "../src/git/git.js";
import { loadState } from "../src/state/store.js";
import { approveInteractively } from "../src/work/approve.js";
import { advanceSdd, startSdd } from "../src/work/sdd.js";

async function repository(): Promise<{ cwd: string; git: GitRepository }> {
  const cwd = await mkdtemp(join(tmpdir(), "ways-sdd-"));
  const git = new GitRepository(cwd);
  await git.run(["init", "-q"]);
  await git.run(["config", "user.name", "Ways Test"]);
  await git.run(["config", "user.email", "ways@example.test"]);
  await writeFile(join(cwd, ".gitkeep"), "");
  await git.run(["add", ".gitkeep"]);
  await git.run(["commit", "-q", "-m", "initial"]);
  await bootstrap({ cwd, testCommand: [process.execPath, "-e", "process.exit(0)"] });
  await git.run(["add", "."]);
  await git.run(["commit", "-q", "-m", "bootstrap"]);
  return { cwd, git };
}

async function fill(cwd: string, id: string, phase: string): Promise<void> {
  const path = join(cwd, `.ways/sdd/${id}/${phase}.md`);
  const content = await readFile(path, "utf8");
  await writeFile(path, content.replace("Goal:", "Goal: deliver behavior").replace("Evidence:", "Evidence: repository inspection"));
}

describe("SDD machine", () => {
  it("advances only through certified phase commits", async () => {
    const { cwd, git } = await repository();
    await startSdd(cwd, "auth-refresh", "autonomous");
    await fill(cwd, "auth-refresh", "intake");
    await advanceSdd(cwd);
    expect((await loadState(cwd))?.phase).toBe("explore");
    expect((await git.lastCommit()).trailers.phase).toBe("intake");
    await fill(cwd, "auth-refresh", "explore");
    await advanceSdd(cwd);
    expect((await loadState(cwd))?.phase).toBe("assess");
  });

  it("requires approval at supervised human gates", async () => {
    const { cwd } = await repository();
    await startSdd(cwd, "safe-change", "supervised");
    await fill(cwd, "safe-change", "intake");
    await expect(advanceSdd(cwd)).rejects.toThrow("human approval");
    await approveInteractively(cwd, { interactive: true, ask: async () => "intake", say: () => undefined });
    await expect(advanceSdd(cwd)).resolves.toBeTruthy();
  });
});
