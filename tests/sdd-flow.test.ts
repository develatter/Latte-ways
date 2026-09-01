import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { bootstrap } from "../src/bootstrap/bootstrap.js";
import { GitRepository } from "../src/git/git.js";
import { loadState } from "../src/state/store.js";
import { advanceSdd, startSdd } from "../src/work/sdd.js";
import { submitReview } from "../src/work/review.js";

async function setup(): Promise<{ cwd: string; git: GitRepository }> {
  const cwd = await mkdtemp(join(tmpdir(), "ways-flow-"));
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

async function fill(cwd: string, work: string, phase: string): Promise<void> {
  const path = join(cwd, `.ways/sdd/${work}/${phase}.md`);
  const content = await readFile(path, "utf8");
  await writeFile(path, content.replace("Goal:", `Goal: complete ${phase}`).replace("Evidence:", "Evidence: verified artifact"));
}

it("runs every SDD phase without allowing a skipped gate", async () => {
  const { cwd, git } = await setup();
  const work = "complete-flow";
  await startSdd(cwd, work, "autonomous");
  for (const phase of ["intake", "explore", "assess", "specify", "plan", "decompose", "implement"]) {
    await fill(cwd, work, phase);
    if (phase === "implement") await writeFile(join(cwd, "feature.ts"), "export const done = true;\n");
    await advanceSdd(cwd);
  }
  await fill(cwd, work, "review");
  const reviewPath = join(cwd, ".ways/runtime/review.json");
  await mkdir(join(cwd, ".ways/runtime"), { recursive: true });
  await writeFile(reviewPath, JSON.stringify({ schemaVersion: 1, workId: work, reviewer: "independent/reviewer", verdict: "pass", findings: [] }));
  await submitReview(cwd, reviewPath);
  await advanceSdd(cwd);
  for (const phase of ["validate", "reconcile-memory", "close"]) {
    await fill(cwd, work, phase);
    await advanceSdd(cwd);
  }
  expect(await loadState(cwd)).toBeUndefined();
  expect((await git.lastCommit()).trailers.phase).toBe("close");
  expect(await git.status()).toEqual([]);
});
