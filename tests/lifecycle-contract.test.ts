import { describe, expect, it } from "vitest";
import { attemptNumber, certificationFailure, lifecycleContract, nextPhase } from "../src/domain/lifecycle.js";
import { validationDetails } from "../src/domain/validation.js";
import { auditHistory, replayCommits } from "../src/integrity/history.js";
import type { CommitInfo } from "../src/git/git.js";

function commit(index: number, phase: string | undefined, attempt?: number, state = "completed"): CommitInfo {
  return {
    hash: `${String(index).padStart(2, "0")}${"a".repeat(38)}`,
    subject: `${state} ${phase ?? "work"}`,
    body: "",
    trailers: { work: "lifecycle", ...(phase === undefined ? {} : { phase }), state, ...(attempt === undefined ? {} : { attempt: String(attempt) }) },
  };
}


describe("versioned lifecycle contract", () => {
  it("rejects unknown versions and malformed attempts with actionable diagnostics", () => {
    expect(() => lifecycleContract(99, "state record")).toThrow(/unsupported lifecycle contract version 99/);
    expect(() => attemptNumber("1.0", "history trailer")).toThrow(/Attempt .*history trailer/);
    expect(validationDetails("state", { schemaVersion: 99 }).errors[0]).toMatch(/unsupported lifecycle contract version 99/);
  });
  it("ignores non-SDD completion commits without a phase", () => {
    expect(replayCommits([commit(0, undefined)]).issues).toEqual([]);
  });

  it("propagates unknown legacy remediation versions at the history boundary", async () => {
    const legacy = commit(1, undefined, 1, "remediated");
    const record = { schemaVersion: 99 };
    const git = { run: async () => JSON.stringify(record) };
    await expect(auditHistory(git as never, [legacy])).rejects.toThrow(/unsupported lifecycle contract version 99/);
  });
  it("seeds transport-merge validation from the first-parent lifecycle prefix", async () => {
    const intake = commit(1, "intake");
    const explore = commit(2, "explore");
    const merge: CommitInfo = {
      hash: `${"03"}${"a".repeat(38)}`,
      subject: "transport merge",
      body: "",
      trailers: {},
    };
    const git = {
      isAncestor: async (candidate: string, base: string) => candidate === intake.hash && base === intake.hash,
      parents: async () => [intake.hash, explore.hash],
      treeId: async () => "tree",
      mergedTree: async () => "tree",
      run: async () => explore.hash,
      commitInfo: async () => explore,
    };
    await expect(auditHistory(git as never, [intake, merge])).resolves.toMatchObject({ issues: [] });
  });
  it("hydrates legacy remediation before validating a transport merge continuation", async () => {
    const phases = ["intake", "explore", "assess", "specify", "plan", "decompose", "implement"];
    const prefix = phases.map((phase, index) => commit(index + 1, phase));
    const base = prefix.at(-1)!;
    const legacy = commit(9, undefined, 1, "remediated");
    const merge: CommitInfo = { hash: `${"10"}${"a".repeat(38)}`, subject: "legacy transport merge", body: "", trailers: {} };
    const record = {
      schemaVersion: 1,
      workId: "lifecycle",
      source: "review",
      target: "implement",
      reason: "repair",
      evidence: {
        kind: "review",
        review: { schemaVersion: 1, workId: "lifecycle", reviewer: "reviewer", digest: "a".repeat(64), verdict: "fail", findings: [] },
      },
      priorCheckpoint: base.hash,
      attempt: 1,
      timestamp: "2026-01-01T00:00:00Z",
    };
    const git = {
      isAncestor: async (candidate: string, parent: string) => parent === base.hash && (candidate === base.hash || prefix.some((entry) => entry.hash === candidate)),
      parents: async () => [base.hash, legacy.hash],
      treeId: async () => "tree",
      mergedTree: async () => "tree",
      run: async (args: readonly string[]) => args[0] === "rev-list" ? legacy.hash : args[0] === "show" ? JSON.stringify(record) : "",
      commitInfo: async () => legacy,
    };
    const result = await auditHistory(git as never, [...prefix, legacy, merge]);
    expect(result.checkpoints).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "remediation", attempt: 1, target: "implement" })]));
    expect(result.issues.map((issue) => issue.code)).not.toContain("history-broken-chain");
  });

  it("keeps normal completion semantics and exposes recovery adjacency", () => {
    const phases = ["intake", "explore", "assess", "specify", "plan", "decompose", "implement", "review", "validate", "reconcile-memory", "close"];
    const replay = replayCommits(phases.map((phase, index) => commit(index, phase)));
    expect(replay.issues).toEqual([]);
    expect(replay.checkpoints).toHaveLength(phases.length);
    expect(nextPhase("implement")).toBe("review");
    expect(nextPhase("close")).toBeUndefined();
  });

  it("replays additive remediation without changing legacy attempt-zero meaning", () => {
    const phases = ["intake", "explore", "assess", "specify", "plan", "decompose", "implement"];
    const commits = phases.map((phase, index) => commit(index, phase));
    commits.push(commit(7, "review", 1, "remediated-implement"));
    commits.push(commit(8, "implement", 1));
    const replay = replayCommits(commits);
    expect(replay.issues).toEqual([]);
    expect(replay.checkpoints.at(-2)).toMatchObject({ kind: "remediation", attempt: 1, target: "implement" });
    expect(replay.checkpoints.at(-1)).toMatchObject({ kind: "certification", attempt: 1, phase: "implement" });
  });

  it("fails closed for tampered order and validation bypasses", () => {
    const outOfOrder = replayCommits([commit(0, "implement")]);
    expect(outOfOrder.issues.map((issue) => issue.code)).toContain("history-broken-chain");
    const message = certificationFailure({
      workId: "lifecycle",
      completedPhase: "review",
      expectedPhase: "review",
      attempt: 0,
      expectedAttempt: 0,
      validationFailed: true,
    });
    expect(message).toMatch(/remediation is required/);
  });
});
