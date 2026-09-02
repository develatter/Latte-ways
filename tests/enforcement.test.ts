import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bootstrap } from "../src/bootstrap/bootstrap.js";
import { STATUS_PATH } from "../src/domain/constants.js";
import { GitRepository, GitError } from "../src/git/git.js";
import { judgeCommitMessage } from "../src/hooks/hook.js";
import { auditCommits, checkHistory } from "../src/integrity/history.js";
import { checkIntegrity } from "../src/integrity/integrity.js";
import { projectStatus, readStatus } from "../src/state/status.js";
import { loadState } from "../src/state/store.js";
import { finishQuick, startQuick } from "../src/work/quick.js";
import { advanceSdd, startSdd } from "../src/work/sdd.js";

async function repository(): Promise<{ cwd: string; git: GitRepository }> {
  const cwd = await mkdtemp(join(tmpdir(), "ways-enforce-"));
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

async function fillPhase(cwd: string, id: string, phase: string): Promise<void> {
  await writeFile(join(cwd, ".ways", "sdd", id, `${phase}.md`), `# ${phase}\n\nGoal: x\nEvidence: y\nDecision: z\nGate: go\n`);
}

describe("status artifact", () => {
  it("mirrors the active state and idles after close", async () => {
    const { cwd } = await repository();
    expect((await readStatus(cwd))?.active).toBe(false);
    await startQuick(cwd, "tiny-fix");
    const active = await readStatus(cwd);
    expect(active).toMatchObject({ active: true, mode: "quick", id: "tiny-fix", status: "active" });
    expect(active).toEqual(projectStatus(await loadState(cwd)));
    await writeFile(join(cwd, "a.txt"), "a\n");
    await finishQuick(cwd, "fix: a", "unchanged");
    expect((await readStatus(cwd))?.active).toBe(false);
  });

  it("marks supervised human gates", async () => {
    const { cwd } = await repository();
    await startSdd(cwd, "guarded", "supervised");
    expect(await readStatus(cwd)).toMatchObject({ phase: "intake", profile: "supervised", humanGate: true });
  });

  it("fails integrity when the artifact diverges", async () => {
    const { cwd } = await repository();
    await startQuick(cwd, "tiny-fix");
    await writeFile(join(cwd, STATUS_PATH), `${JSON.stringify({ schemaVersion: 1, active: false, updatedAt: "x" })}\n`);
    const codes = (await checkIntegrity(cwd)).map((issue) => issue.code);
    expect(codes).toContain("status-divergence");
  });
});

describe("commit-msg hook", () => {
  it("rejects commits without an active work once bootstrapped", async () => {
    const { cwd, git } = await repository();
    await writeFile(join(cwd, "b.txt"), "b\n");
    await git.run(["add", "b.txt"]);
    await expect(git.run(["commit", "-q", "-m", "sneaky"])).rejects.toBeInstanceOf(GitError);
    expect((await judgeCommitMessage(cwd, "sneaky")).reason).toMatch(/ways quick start/);
  });

  it("requires the active work id and accepts closing commits from HEAD state", async () => {
    const { cwd, git } = await repository();
    await startSdd(cwd, "traced", "autonomous");
    expect((await judgeCommitMessage(cwd, "x\n\nHarness-Work: other")).accepted).toBe(false);
    expect((await judgeCommitMessage(cwd, "x\n\nHarness-Work: traced")).accepted).toBe(true);
    await fillPhase(cwd, "traced", "intake");
    await advanceSdd(cwd);
    expect(await git.run(["show", "HEAD:.ways/state/current.json"])).toContain("\"traced\"");
    await rm(join(cwd, ".ways/state/current.json"));
    const closing = await judgeCommitMessage(cwd, "done\n\nHarness-Work: traced\nHarness-State: completed");
    expect(closing.accepted).toBe(true);
    const wrong = await judgeCommitMessage(cwd, "done\n\nHarness-Work: traced\nHarness-State: proposed");
    expect(wrong.accepted).toBe(false);
  });

  it("lets the harness create its own gate commits", async () => {
    const { cwd, git } = await repository();
    await startSdd(cwd, "gated", "autonomous");
    await fillPhase(cwd, "gated", "intake");
    await advanceSdd(cwd);
    expect((await git.lastCommit()).trailers).toMatchObject({ work: "gated", phase: "intake", state: "completed" });
  });
});

describe("history verification", () => {
  it("flags untraced commits after the anchor and broken SDD chains", () => {
    const commit = (subject: string, trailers: Record<string, string>) => ({ hash: "0123456789abcdef", subject, body: "", trailers });
    const issues = auditCommits([
      commit("ok", { work: "w", state: "completed", phase: "intake" }),
      commit("skip", { work: "w", state: "completed", phase: "assess" }),
      commit("manual", {}),
    ]);
    expect(issues.map((issue) => issue.code)).toEqual(["history-broken-chain", "history-untraced"]);
  });

  it("exempts history up to the bootstrap commit and catches --no-verify commits", async () => {
    const { cwd, git } = await repository();
    expect(await checkHistory(cwd)).toEqual([]);
    await writeFile(join(cwd, "c.txt"), "c\n");
    await git.run(["add", "c.txt"]);
    await git.run(["commit", "-q", "--no-verify", "-m", "bypassed"]);
    const issues = await checkHistory(cwd);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("history-untraced");
    expect(await checkHistory(cwd, { since: "HEAD" })).toEqual([]);
  });

  it("fails integrity for commits inside an active work that lack its trailer", async () => {
    const { cwd, git } = await repository();
    await startQuick(cwd, "tiny-fix");
    await writeFile(join(cwd, "d.txt"), "d\n");
    await git.run(["add", "d.txt"]);
    await git.run(["commit", "-q", "--no-verify", "-m", "bypassed"]);
    const codes = (await checkIntegrity(cwd)).map((issue) => issue.code);
    expect(codes).toContain("work-untraced");
  });
});

describe("bootstrap hooks", () => {
  it("installs a managed commit-msg hook and points core.hooksPath at it", async () => {
    const { cwd, git } = await repository();
    expect(await git.run(["config", "core.hooksPath"])).toBe(".ways/hooks");
    const manifest = JSON.parse(await readFile(join(cwd, ".ways/manifest.json"), "utf8")) as { managedFiles: Record<string, string> };
    expect(Object.keys(manifest.managedFiles)).toContain(".ways/hooks/commit-msg");
  });
});
