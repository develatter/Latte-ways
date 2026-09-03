import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { WorkState } from "../src/domain/types.js";
import { approvalBinds, approvalPath } from "../src/work/approve.js";
import { attemptReviewPath, remediationRecordPath } from "../src/work/attempt.js";
import { implementationCycleBaseline, workDigest } from "../src/work/digest.js";
import { reviewDigest, submitReview } from "../src/work/review.js";
import { GitRepository } from "../src/git/git.js";
import { saveState } from "../src/state/store.js";

async function repository(): Promise<{ cwd: string; git: GitRepository; initial: string }> {
  const cwd = await mkdtemp(join(tmpdir(), "ways-attempt-evidence-"));
  const git = new GitRepository(cwd);
  await git.run(["init", "-q"]);
  await git.run(["config", "user.name", "Ways Test"]);
  await git.run(["config", "user.email", "ways@example.test"]);
  await writeFile(join(cwd, ".gitkeep"), "");
  const initial = await git.commit([".gitkeep"], "initial", {});
  return { cwd, git, initial };
}

function state(id: string, gateCommit: string, attempt?: number): WorkState {
  const remediation = attempt === undefined ? undefined : {
    source: "review" as const,
    target: "implement" as const,
    reason: "Fix the failed review",
    evidence: {
      kind: "review" as const,
      review: {
        schemaVersion: 1 as const,
        workId: id,
        reviewer: "ways-reviewer",
        digest: "0".repeat(64),
        verdict: "fail" as const,
        findings: [],
      },
    },
    priorCheckpoint: gateCommit,
    attempt,
    timestamp: "2026-01-01T00:00:00Z",
  };
  return {
    schemaVersion: 1,
    harnessVersion: "test",
    id,
    mode: "sdd",
    status: "active",
    phase: "review",
    lastCompletedPhase: "implement",
    baseCommit: gateCommit,
    gateCommit,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    tasks: [],
    ...(attempt === undefined ? {} : { attempt, remediation }),
  };
}

describe("attempt-aware review evidence", () => {
  it("digests the entire initial implementation cycle rather than only its final integration", async () => {
    const { cwd, git, initial } = await repository();
    await mkdir(join(cwd, ".ways/sdd/rev"), { recursive: true });
    await writeFile(join(cwd, ".ways/sdd/rev/decompose.md"), "# decompose\n");
    const decompose = await git.commit([".ways/sdd/rev/decompose.md"], "decompose", { work: "rev", phase: "decompose", state: "completed" });
    await writeFile(join(cwd, "first.ts"), "export const first = true;\n");
    await git.commit(["first.ts"], "first integration", { work: "rev", task: "first" });
    await writeFile(join(cwd, "last.ts"), "export const last = true;\n");
    const last = await git.commit(["last.ts"], "last integration", { work: "rev", task: "last" });

    const current = state("rev", last);
    expect(await implementationCycleBaseline(cwd, current)).toBe(decompose);
    expect(await workDigest(cwd, await implementationCycleBaseline(cwd, current))).not.toBe(await workDigest(cwd, last));
    expect(initial).not.toBe(decompose);
  });

  it("requires later reviews to bind their attempt and stores them separately", async () => {
    const { cwd, git, initial } = await repository();
    const current = state("rev", initial, 1);
    const record = remediationRecordPath("rev", 1);
    await mkdir(join(cwd, record, ".."), { recursive: true });
    await writeFile(join(cwd, record), "{}\n");
    const transition = await git.commit([record], "remediate", { work: "rev", state: "remediated", attempt: "1" });
    await saveState(cwd, { ...current, gateCommit: transition });
    await writeFile(join(cwd, "fix.ts"), "export const fixed = true;\n");

    const input = join(await mkdtemp(join(tmpdir(), "ways-review-input-")), "review.json");
    const digest = await reviewDigest(cwd);
    await writeFile(input, JSON.stringify({ schemaVersion: 1, workId: "rev", reviewer: "ways-reviewer", digest, verdict: "pass", findings: [] }));
    await expect(submitReview(cwd, input)).rejects.toThrow(/attempt does not match/);

    await writeFile(input, JSON.stringify({ schemaVersion: 1, workId: "rev", attempt: 1, reviewer: "ways-reviewer", digest, verdict: "pass", findings: [] }));
    await submitReview(cwd, input);
    expect(JSON.parse(await readFile(join(cwd, attemptReviewPath("rev", 1)), "utf8"))).toMatchObject({ attempt: 1 });
  });
});

describe("attempt-aware approval evidence", () => {
  it("keeps attempt-zero paths and rejects approvals from another attempt", () => {
    expect(approvalPath("rev", "intake")).toBe(".ways/sdd/rev/approvals/intake.json");
    expect(approvalPath("rev", "intake", 2)).toBe(".ways/sdd/rev/attempts/2/approvals/intake.json");
    expect(approvalBinds({
      schemaVersion: 1,
      workId: "rev",
      phase: "intake",
      attempt: 1,
      gateCommit: "a".repeat(40),
      digest: "0".repeat(64),
      approvedBy: "human",
      approvedAt: "2026-01-01T00:00:00Z",
    }, { workId: "rev", phase: "intake", gateCommit: "a".repeat(40), attempt: 2 })).toMatch(/another remediation attempt/);
  });
});
