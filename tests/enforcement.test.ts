import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
import { cancelQuick, finishQuick, startQuick } from "../src/work/quick.js";
import { integrateTask, prepareTask } from "../src/work/tasks.js";
import { saveState } from "../src/state/store.js";
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

const execFileAsync = promisify(execFile);

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

  it("leaves no diff behind when quick work is cancelled", async () => {
    const { cwd, git } = await repository();
    await startQuick(cwd, "tiny-fix");
    await cancelQuick(cwd);
    expect(await git.status()).toEqual([]);
    await startQuick(cwd, "next-fix");
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

  it("requires the active work id and accepts a staged closing commit from HEAD state", async () => {
    const { cwd, git } = await repository();
    await startSdd(cwd, "traced", "autonomous");
    expect((await judgeCommitMessage(cwd, "x\n\nHarness-Work: other")).accepted).toBe(false);
    expect((await judgeCommitMessage(cwd, "x\n\nHarness-Work: traced")).accepted).toBe(true);
    await fillPhase(cwd, "traced", "intake");
    await advanceSdd(cwd);
    expect(await git.run(["show", "HEAD:.ways/state/current.json"])).toContain("\"traced\"");
    await rm(join(cwd, ".ways/state/current.json"));
    await git.run(["add", "-A", ".ways/state"]);
    const wrong = await judgeCommitMessage(cwd, "done\n\nHarness-Work: traced\nHarness-Phase: close\nHarness-State: proposed");
    expect(wrong.accepted).toBe(false);
    const cancelled = await judgeCommitMessage(cwd, "done\n\nHarness-Work: traced\nHarness-State: cancelled");
    expect(cancelled.accepted).toBe(true);
  });

  it("rejects a hand-written closing commit that keeps the state file", async () => {
    const { cwd, git } = await repository();
    await startSdd(cwd, "forged", "autonomous");
    await fillPhase(cwd, "forged", "intake");
    await advanceSdd(cwd);
    await rm(join(cwd, ".ways/state/current.json"));
    const unstaged = await judgeCommitMessage(cwd, "done\n\nHarness-Work: forged\nHarness-Phase: close\nHarness-State: completed");
    expect(unstaged.accepted).toBe(false);
    await git.run(["add", "-A", ".ways/state"]);
    const noPhase = await judgeCommitMessage(cwd, "done\n\nHarness-Work: forged\nHarness-State: completed");
    expect(noPhase.accepted).toBe(false);
    const closing = await judgeCommitMessage(cwd, "done\n\nHarness-Work: forged\nHarness-Phase: close\nHarness-State: completed");
    expect(closing.accepted).toBe(true);
  });

  it("resolves the CLI from a consumer node_modules inside a task worktree without WAYS_CLI", async () => {
    const { cwd, git } = await repository();
    await mkdir(join(cwd, "node_modules"));
    await symlink(join(import.meta.dirname, ".."), join(cwd, "node_modules", "latte-ways"));
    const head = await git.head();
    await saveState(cwd, {
      schemaVersion: 1, harnessVersion: "0.1.0", id: "wt", mode: "sdd", status: "active", profile: "autonomous",
      phase: "implement", lastCompletedPhase: "decompose", baseCommit: head, gateCommit: await git.parent(head),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      tasks: [{ id: "api", title: "Build API", status: "ready", dependsOn: [], commits: [] }],
    });
    const gate = await git.commit(await git.changedPaths(), "sdd(decompose): complete wt", { work: "wt", phase: "decompose", state: "completed" });
    const task = await prepareTask(cwd, "api");
    await writeFile(join(task.worktree!, "api.ts"), "export const api = true;\n");
    const env = { ...process.env };
    delete env.WAYS_CLI;
    await execFileAsync("git", ["add", "api.ts"], { cwd: task.worktree! });
    await expect(execFileAsync("git", ["commit", "-q", "-m", "feat: api"], { cwd: task.worktree!, env })).rejects.toThrow(/Active sdd work is wt/);
    await execFileAsync("git", ["commit", "-q", "-m", "feat: api", "-m", "Harness-Work: wt\nHarness-Task: api"], { cwd: task.worktree!, env });
    const worker = new GitRepository(task.worktree!);
    await integrateTask(cwd, "api", [await worker.head()]);
    expect(await checkHistory(cwd, { since: gate })).toEqual([]);
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

  it("accepts a complete SDD certification chain", async () => {
    const { cwd } = await repository();
    await startSdd(cwd, "chain", "autonomous");
    for (const phase of ["intake", "explore", "assess"]) {
      await fillPhase(cwd, "chain", phase);
      await advanceSdd(cwd);
    }
    expect(await checkHistory(cwd)).toEqual([]);
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

describe("delegated execution", () => {
  async function delegatedAtImplement(cwd: string): Promise<void> {
    await startSdd(cwd, "deleg", "autonomous", "delegated");
    expect((await readStatus(cwd))?.execution).toBe("delegated");
    const { addTask } = await import("../src/work/tasks.js");
    for (const phase of ["intake", "explore", "assess", "specify", "plan"]) {
      await fillPhase(cwd, "deleg", phase);
      await advanceSdd(cwd);
    }
    await addTask(cwd, "api", "Build API");
    await fillPhase(cwd, "deleg", "decompose");
    await advanceSdd(cwd);
    await fillPhase(cwd, "deleg", "implement");
  }

  async function integrateWorker(cwd: string): Promise<void> {
    const { integrateTask, prepareTask } = await import("../src/work/tasks.js");
    const task = await prepareTask(cwd, "api");
    const worker = new GitRepository(task.worktree!);
    await writeFile(join(task.worktree!, "api.ts"), "export const api = true;\n");
    await integrateTask(cwd, "api", [await worker.commit(["api.ts"], "feat: api", { work: "deleg", task: "api" })]);
  }

  it("certifies implement when every commit was integrated from a task", async () => {
    const { cwd, git } = await repository();
    await delegatedAtImplement(cwd);
    await expect(advanceSdd(cwd)).rejects.toThrow(/must be integrated/);
    await integrateWorker(cwd);
    await advanceSdd(cwd);
    expect((await git.lastCommit()).trailers.phase).toBe("implement");
  });

  it("rejects orchestrator commits, even with forged task trailers", async () => {
    const { cwd, git } = await repository();
    await delegatedAtImplement(cwd);
    await integrateWorker(cwd);
    await writeFile(join(cwd, "forged.ts"), "// orchestrator wrote this\n");
    await git.commit(["forged.ts"], "feat: forged", { work: "deleg", task: "api" });
    await expect(advanceSdd(cwd)).rejects.toThrow(/"feat: forged" was not integrated from a task/);
  });

  it("clears execution when downgrading", async () => {
    const { cwd } = await repository();
    await startSdd(cwd, "deleg", "autonomous", "delegated");
    for (const phase of ["intake", "explore"]) {
      await fillPhase(cwd, "deleg", phase);
      await advanceSdd(cwd);
    }
    await fillPhase(cwd, "deleg", "assess");
    const { downgradeSdd } = await import("../src/work/sdd.js");
    await downgradeSdd(cwd, "quick");
    expect((await loadState(cwd))?.execution).toBeUndefined();
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
