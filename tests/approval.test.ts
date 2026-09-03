import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bootstrap } from "../src/bootstrap/bootstrap.js";
import { GitRepository } from "../src/git/git.js";
import { judgeCommitMessage } from "../src/hooks/hook.js";
import { auditCommits, checkHistory } from "../src/integrity/history.js";
import { promotePlan, proposePlan, startPlan } from "../src/work/plan.js";
import { loadState, saveState } from "../src/state/store.js";
import { approveInteractively, approvalPath, assertApproved, type Terminal } from "../src/work/approve.js";
import { attemptPhasePath } from "../src/work/attempt.js";
import { reviewDigest, submitReview } from "../src/work/review.js";
import { advanceSdd, startSdd } from "../src/work/sdd.js";

const execFileAsync = promisify(execFile);

async function repository(): Promise<{ cwd: string; git: GitRepository }> {
  const cwd = await mkdtemp(join(tmpdir(), "ways-approve-"));
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
  await writeFile(join(cwd, ".ways", "sdd", id, `${phase}.md`), `# ${phase}\n\nGoal: x\nEvidence: y\nDecision: z\nGate: go\n`);
}

function terminal(interactive: boolean, answer: string): Terminal {
  return { interactive, ask: async () => answer, say: () => undefined };
}

async function approve(cwd: string, phase: string): Promise<void> {
  await approveInteractively(cwd, terminal(true, phase));
}

async function setRemediatedGate(cwd: string, phase: "plan" | "close"): Promise<void> {
  const state = (await loadState(cwd))!;
  state.phase = phase;
  state.attempt = 1;
  state.remediation = {
    source: "review",
    target: "plan",
    reason: "Address review finding",
    evidence: {
      kind: "review",
      review: {
        schemaVersion: 1,
        workId: state.id,
        reviewer: "ways-reviewer",
        digest: "0".repeat(64),
        verdict: "fail",
        findings: [],
      },
    },
    priorCheckpoint: state.gateCommit,
    attempt: 1,
    timestamp: "2026-01-01T00:00:00Z",
  };
  const path = join(cwd, attemptPhasePath(state.id, state.attempt, phase));
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `# ${phase}\n\nGoal: current attempt\nEvidence: review remediation\n`);
  await saveState(cwd, state);
}

describe("human approvals", () => {
  it("blocks a supervised gate until a human approves in a terminal", async () => {
    const { cwd } = await repository();
    await startSdd(cwd, "sup", "supervised");
    await fill(cwd, "sup", "intake");
    await expect(advanceSdd(cwd)).rejects.toThrow(/requires explicit human approval/);
    await expect(approveInteractively(cwd, terminal(false, "intake"))).rejects.toThrow(/interactive terminal/);
    await expect(approveInteractively(cwd, terminal(true, "yes"))).rejects.toThrow(/cancelled/);
    const lines: string[] = [];
    const record = await approveInteractively(cwd, {
      interactive: true,
      ask: async () => "intake",
      say: (line) => lines.push(line),
    });
    expect(lines).toContain("Read .ways/sdd/sup/intake.md and the diff since the gate before approving.");
    expect(record).toMatchObject({ workId: "sup", phase: "intake", approvedBy: "Ways Test <ways@example.test>" });
    const gate = await advanceSdd(cwd);
    const git = new GitRepository(cwd);
    expect(await git.run(["show", "--name-only", "--format=", gate])).toContain(approvalPath("sup", "intake"));
    expect((await loadState(cwd))?.phase).toBe("explore");
  });

  it("refuses the CLI approval without a TTY", async () => {
    const { cwd } = await repository();
    await startSdd(cwd, "sup", "supervised");
    await expect(execFileAsync(process.execPath, [process.env.WAYS_CLI!, "approve"], { cwd })).rejects.toThrow(/interactive terminal/);
  });

  it("dies when content changes or the gate moves after approval", async () => {
    const { cwd } = await repository();
    await startSdd(cwd, "sup", "supervised");
    await fill(cwd, "sup", "intake");
    await approve(cwd, "intake");
    await writeFile(join(cwd, ".ways/sdd/sup/intake.md"), "# intake\n\nGoal: changed\nEvidence: after approval\n");
    await expect(advanceSdd(cwd)).rejects.toThrow(/content changed after approval/);
    await fill(cwd, "sup", "intake");
    await advanceSdd(cwd);
    await fill(cwd, "sup", "explore");
    await expect(approve(cwd, "explore")).rejects.toThrow(/does not require human approval/);
    await advanceSdd(cwd);
    for (const phase of ["assess", "specify"]) {
      await fill(cwd, "sup", phase);
      await advanceSdd(cwd);
    }
    const stale = JSON.parse(await readFile(join(cwd, approvalPath("sup", "intake")), "utf8"));
    await mkdir(join(cwd, ".ways/sdd/sup/approvals"), { recursive: true });
    await writeFile(join(cwd, approvalPath("sup", "plan")), JSON.stringify({ ...stale, phase: "plan" }));
    await fill(cwd, "sup", "plan");
    await expect(advanceSdd(cwd)).rejects.toThrow(/another gate commit/);
  });

  it("shows active remediated plan and close artifacts and rejects stale approvals", async () => {
    const { cwd } = await repository();
    await startSdd(cwd, "sup", "supervised");

    for (const phase of ["plan", "close"] as const) {
      await setRemediatedGate(cwd, phase);
      const lines: string[] = [];
      const record = await approveInteractively(cwd, {
        interactive: true,
        ask: async () => phase,
        say: (line) => lines.push(line),
      });
      const artifact = attemptPhasePath("sup", 1, phase);
      expect(lines).toContain(`Read ${artifact} and the diff since the gate before approving.`);
      expect(record).toMatchObject({ phase, attempt: 1 });
      expect(await readFile(join(cwd, approvalPath("sup", phase, 1)), "utf8")).toContain('"attempt": 1');
    }

    const activeCloseApproval = JSON.parse(await readFile(join(cwd, approvalPath("sup", "close", 1)), "utf8"));
    await writeFile(join(cwd, approvalPath("sup", "close", 1)), JSON.stringify({ ...activeCloseApproval, attempt: 0 }));
    await expect(assertApproved(cwd, (await loadState(cwd))!)).rejects.toThrow(/another remediation attempt/);
  });

  it("runs a supervised work end to end through the hook, approving intake, plan and close", async () => {
    const { cwd, git } = await repository();
    await startSdd(cwd, "sup", "supervised");
    expect((await git.lastCommit()).trailers).toMatchObject({ work: "sup", state: "opened" });
    for (const phase of ["intake", "explore", "assess", "specify", "plan", "decompose", "implement"]) {
      await fill(cwd, "sup", phase);
      if (phase === "implement") await writeFile(join(cwd, "feature.ts"), "export const a = 1;\n");
      if (phase === "intake" || phase === "plan") await approve(cwd, phase);
      await advanceSdd(cwd);
    }
    await fill(cwd, "sup", "review");
    await mkdir(join(cwd, ".ways/runtime"), { recursive: true });
    const path = join(cwd, ".ways/runtime/review.json");
    await writeFile(path, JSON.stringify({ schemaVersion: 1, workId: "sup", reviewer: "ways-reviewer", digest: await reviewDigest(cwd), verdict: "pass", findings: [] }));
    await submitReview(cwd, path);
    await advanceSdd(cwd);
    for (const phase of ["validate", "reconcile-memory", "close"]) {
      await fill(cwd, "sup", phase);
      if (phase === "close") {
        await expect(advanceSdd(cwd)).rejects.toThrow(/requires explicit human approval/);
        await approve(cwd, phase);
      }
      await advanceSdd(cwd);
    }
    expect(await loadState(cwd)).toBeUndefined();
    expect(await git.status()).toEqual([]);
    const log = await git.run(["log", "--format=%s"]);
    expect(log).toContain("sdd(close): record approval of sup");
    expect(log.split("\n")[0]).toBe("sdd(close): complete sup");
  });

  it("rejects flipping the profile on disk to dodge a human gate", async () => {
    const { cwd } = await repository();
    await startSdd(cwd, "sup", "supervised");
    await fill(cwd, "sup", "intake");
    const state = (await loadState(cwd))!;
    state.profile = "autonomous";
    await writeFile(join(cwd, ".ways/state/current.json"), JSON.stringify(state));
    await expect(advanceSdd(cwd)).rejects.toThrow(/profile changed outside a gate/);
    const forged = "sdd(intake): complete sup\n\nHarness-Work: sup\nHarness-Phase: intake\nHarness-State: completed\n";
    expect((await judgeCommitMessage(cwd, forged)).reason).toMatch(/profile changed outside a gate/);
  });

  it("rejects renaming the work on disk to shed the committed profile", async () => {
    const { cwd } = await repository();
    await startSdd(cwd, "sup", "supervised");
    const state = (await loadState(cwd))!;
    const head = await new GitRepository(cwd).head();
    const renamed = { ...state, id: "sup2", profile: "autonomous", baseCommit: head, gateCommit: head };
    await writeFile(join(cwd, ".ways/state/current.json"), JSON.stringify(renamed));
    await mkdir(join(cwd, ".ways/sdd/sup2"), { recursive: true });
    await fill(cwd, "sup2", "intake");
    await expect(advanceSdd(cwd)).rejects.toThrow(/rewritten outside a gate/);
    const forged = "sdd(intake): complete sup2\n\nHarness-Work: sup2\nHarness-Phase: intake\nHarness-State: completed\n";
    expect((await judgeCommitMessage(cwd, forged)).reason).toMatch(/rewritten outside a gate/);
    expect(auditCommits([{ hash: "a".repeat(40), subject: "open", body: "", trailers: { work: "sup", phase: "intake", state: "opened" } }], "sup2")).toMatchObject([{ code: "history-abandoned-opening" }]);
    expect(auditCommits([{ hash: "a".repeat(40), subject: "open", body: "", trailers: { work: "sup", phase: "intake", state: "opened" } }], "sup")).toEqual([]);
  });

  it("opens a supervised work promoted from a plan with a traced commit", async () => {
    const { cwd, git } = await repository();
    const plan = await startPlan(cwd, "promo");
    await writeFile(join(cwd, plan.planPath!), (await readFile(join(cwd, plan.planPath!), "utf8")).replace("1. ", "1. Do it"));
    await proposePlan(cwd);
    await promotePlan(cwd, "supervised");
    expect((await git.lastCommit()).trailers).toMatchObject({ work: "promo", state: "opened" });
    await fill(cwd, "promo", "intake");
    await expect(advanceSdd(cwd)).rejects.toThrow(/requires explicit human approval/);
    await approve(cwd, "intake");
    await advanceSdd(cwd);
    expect((await loadState(cwd))?.phase).toBe("explore");
    expect(await checkHistory(cwd)).toEqual([]);
  });

  it("commit-msg hook rejects a forged human-gate certification", async () => {
    const { cwd, git } = await repository();
    await startSdd(cwd, "sup", "supervised");
    await fill(cwd, "sup", "intake");
    const state = (await loadState(cwd))!;
    state.lastCompletedPhase = "intake";
    state.phase = "explore";
    await writeFile(join(cwd, ".ways/state/current.json"), JSON.stringify(state));
    await git.run(["add", "-A"]);
    const forged = "sdd(intake): complete sup\n\nHarness-Work: sup\nHarness-Phase: intake\nHarness-State: completed\n";
    expect(await judgeCommitMessage(cwd, forged)).toMatchObject({ accepted: false, reason: expect.stringMatching(/must stage a human approval/) });
    await mkdir(join(cwd, ".ways/sdd/sup/approvals"), { recursive: true });
    await writeFile(join(cwd, approvalPath("sup", "intake")), JSON.stringify({ schemaVersion: 1, workId: "sup", phase: "intake", gateCommit: "f".repeat(40), digest: "0".repeat(64), approvedBy: "agent", approvedAt: "2026-01-01T00:00:00Z" }));
    await git.run(["add", "-A"]);
    expect((await judgeCommitMessage(cwd, forged)).reason).toMatch(/another gate commit/);
  });
});

describe("review binding", () => {
  async function atReview(cwd: string): Promise<void> {
    await startSdd(cwd, "rev", "autonomous");
    for (const phase of ["intake", "explore", "assess", "specify", "plan", "decompose", "implement"]) {
      await fill(cwd, "rev", phase);
      if (phase === "implement") await writeFile(join(cwd, "feature.ts"), "export const a = 1;\n");
      await advanceSdd(cwd);
    }
    await fill(cwd, "rev", "review");
  }

  async function review(cwd: string, digest: string): Promise<void> {
    await mkdir(join(cwd, ".ways/runtime"), { recursive: true });
    const path = join(cwd, ".ways/runtime/review.json");
    await writeFile(path, JSON.stringify({ schemaVersion: 1, workId: "rev", reviewer: "ways-reviewer", digest, verdict: "pass", findings: [] }));
    await submitReview(cwd, path);
  }

  it("rejects a review of another digest and a review made stale by later edits", async () => {
    const { cwd } = await repository();
    await atReview(cwd);
    await expect(review(cwd, "0".repeat(64))).rejects.toThrow(/does not match the current diff/);
    await writeFile(join(cwd, "feature.ts"), "export const a = 2;\n");
    const digest = await reviewDigest(cwd);
    await review(cwd, digest);
    await writeFile(join(cwd, "feature.ts"), "export const a = 3;\n");
    await expect(advanceSdd(cwd)).rejects.toThrow(/Review is stale/);
    await writeFile(join(cwd, "feature.ts"), "export const a = 2;\n");
    await advanceSdd(cwd);
    expect((await loadState(cwd))?.phase).toBe("validate");
  });
});
