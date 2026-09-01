import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bootstrap } from "../src/bootstrap/bootstrap.js";
import { GitRepository } from "../src/git/git.js";
import { finishPlan, promotePlan, proposePlan, startPlan } from "../src/work/plan.js";

async function repository(): Promise<{ cwd: string; git: GitRepository }> {
  const cwd = await mkdtemp(join(tmpdir(), "ways-plan-"));
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

describe("plan workflow", () => {
  it("versions a proposal and removes it after execution", async () => {
    const { cwd, git } = await repository();
    const state = await startPlan(cwd, "refresh-auth");
    await writeFile(join(cwd, state.planPath!), (await readFile(join(cwd, state.planPath!), "utf8")).replace("1. ", "1. Update token rotation"));
    await proposePlan(cwd);
    expect((await git.lastCommit()).trailers.state).toBe("proposed");
    await writeFile(join(cwd, "auth.ts"), "export const rotation = true;\n");
    await finishPlan(cwd, "feat: refresh auth", "unchanged");
    expect((await git.lastCommit()).trailers.state).toBe("completed");
    expect(await git.status()).toEqual([]);
  });

  it("promotes a clean proposal into SDD without losing its content", async () => {
    const { cwd } = await repository();
    const state = await startPlan(cwd, "promoted-plan");
    await writeFile(join(cwd, state.planPath!), (await readFile(join(cwd, state.planPath!), "utf8")).replace("1. ", "1. Implement safely"));
    await proposePlan(cwd);
    const promoted = await promotePlan(cwd, "supervised");
    expect(promoted.mode).toBe("sdd");
    expect(promoted.phase).toBe("intake");
    expect(await readFile(join(cwd, ".ways/sdd/promoted-plan/source-plan.md"), "utf8")).toContain("Implement safely");
  });
});
