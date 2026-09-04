import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { bootstrap } from "../src/bootstrap/bootstrap.js";
import { run } from "../src/cli.js";
import type { RemediationEvidence, RemediationTarget, ValidationFailureRecord, WorkState } from "../src/domain/types.js";
import { GitRepository } from "../src/git/git.js";
import { judgeCommitMessage } from "../src/hooks/hook.js";
import { checkHistory } from "../src/integrity/history.js";
import { checkIntegrity } from "../src/integrity/integrity.js";
import { loadState, saveState } from "../src/state/store.js";
import { approveInteractively } from "../src/work/approve.js";
import { attemptPhasePath, attemptReviewPath, remediationRecordPath, validationFailureRecordPath } from "../src/work/attempt.js";
import { reviewDigest, submitReview } from "../src/work/review.js";
import { failureEvidenceDigest, remediationEvidenceFailure, remediateSdd } from "../src/work/remediation.js";
import { recordValidationFailure, validationFailureDigest, validationFailureReplayFailure } from "../src/work/validation-failure.js";
import { advanceSdd, assertSddConsistency } from "../src/work/sdd.js";

const targets: RemediationTarget[] = ["implement", "decompose", "plan", "specify"];

async function baseRepository(
  testExit = 0,
  testCommand = [process.execPath, "-e", `process.exit(${testExit})`],
): Promise<{ cwd: string; git: GitRepository; base: string }> {
  const cwd = await mkdtemp(join(tmpdir(), "ways-remediate-"));
  const git = new GitRepository(cwd);
  await git.run(["init", "-q"]);
  await git.run(["config", "user.name", "Ways Test"]);
  await git.run(["config", "user.email", "ways@example.test"]);
  await writeFile(join(cwd, ".gitkeep"), "");
  await git.commit([".gitkeep"], "initial", {});
  await bootstrap({ cwd, testCommand });
  await git.run(["add", "."]);
  await git.run(["commit", "-q", "-m", "bootstrap"]);
  // Synthetic lifecycle setup commits are intentionally assembled directly.
  await git.run(["config", "core.hooksPath", "/dev/null"]);
  return { cwd, git, base: await git.head() };
}

async function completeThroughDecompose(cwd: string, git: GitRepository): Promise<string> {
  await mkdir(join(cwd, ".ways/sdd/failing"), { recursive: true });
  let checkpoint = "";
  for (const phase of ["intake", "explore", "assess", "specify", "plan", "decompose"] as const) {
    const path = `.ways/sdd/failing/${phase}.md`;
    await writeFile(join(cwd, path), `# ${phase}\n\nGoal: complete\nEvidence: test\nDecision: pass\nGate: advance\n`);
    checkpoint = await git.commit([path], phase, { work: "failing", phase, state: "completed" });
  }
  return checkpoint;
}

async function reviewRepository(profile: "autonomous" | "supervised" = "autonomous"): Promise<{ cwd: string; git: GitRepository; reviewPath: string; prior: string }> {
  const { cwd, git, base } = await baseRepository();
  const decompose = await completeThroughDecompose(cwd, git);
  await writeFile(join(cwd, "implementation.ts"), "export const value = 1;\n");
  const now = new Date().toISOString();
  const state: WorkState = {
    schemaVersion: 1, harnessVersion: "test", id: "failing", mode: "sdd", status: "active",
    profile, phase: "review", lastCompletedPhase: "implement", baseCommit: base,
    gateCommit: decompose, createdAt: now, updatedAt: now, tasks: [],
  };
  await writeFile(join(cwd, ".ways/sdd/failing/review.md"), "# review\n\nGoal:\nEvidence:\nDecision:\nGate:\n");
  await saveState(cwd, state);
  await git.commit(await git.changedPaths(), "implement", { work: "failing", phase: "implement", state: "completed" });
  await writeFile(join(cwd, ".ways/sdd/failing/review.md"), "# review\n\nGoal: inspect the implementation\nEvidence: blocking findings\nDecision: fail\nGate: remediate\n");
  const digest = await reviewDigest(cwd);
  const reviewPath = attemptReviewPath("failing", 0);
  await mkdir(join(cwd, reviewPath, ".."), { recursive: true });
  await writeFile(join(cwd, reviewPath), JSON.stringify({
    schemaVersion: 1, workId: "failing", reviewer: "independent", digest, verdict: "fail", findings: [],
  }, null, 2) + "\n");
  return { cwd, git, reviewPath, prior: await git.head() };
}

async function validateRepository(testExit = 7): Promise<{ cwd: string; git: GitRepository; prior: string }> {
  const { cwd, git, base } = await baseRepository(testExit);
  await completeThroughDecompose(cwd, git);
  await writeFile(join(cwd, ".ways/sdd/failing/review.md"), "# review\n\nGoal: inspect\nEvidence: pass\n");
  await writeFile(join(cwd, "implementation.ts"), "export const value = 1;\n");
  const reviewParent = await git.commit([".ways/sdd/failing/review.md", "implementation.ts"], "implement", { work: "failing", phase: "implement", state: "completed" });
  const now = new Date().toISOString();
  await writeFile(join(cwd, ".ways/sdd/failing/validate.md"), "# validate\n\nGoal:\nEvidence:\nDecision:\nGate:\n");
  await saveState(cwd, {
    schemaVersion: 1, harnessVersion: "test", id: "failing", mode: "sdd", status: "active",
    profile: "autonomous", phase: "validate", lastCompletedPhase: "review", baseCommit: base,
    gateCommit: reviewParent, createdAt: now, updatedAt: now, tasks: [],
  });
  await git.commit(await git.changedPaths(), "review", { work: "failing", phase: "review", state: "completed" });
  await recordValidationFailure(cwd);
  return { cwd, git, prior: await git.head() };
}

async function legacyValidationTransition(): Promise<{ cwd: string; git: GitRepository; prior: string }> {
  const { cwd, git } = await validateRepository();
  await git.run(["reset", "--hard", "HEAD^"]);
  const prior = await git.head();
  const state = (await loadState(cwd))!;
  const evidence: RemediationEvidence = {
    kind: "validate",
    failures: [{ check: "configured-tests", detail: "Configured test command exited with status 7" }],
  };
  const timestamp = new Date().toISOString();
  const record = {
    schemaVersion: 1 as const,
    workId: "failing",
    source: "validate" as const,
    target: "implement" as const,
    reason: "legacy inline validation remediation",
    evidence,
    priorCheckpoint: prior,
    attempt: 1,
    timestamp,
  };
  const validatePath = attemptPhasePath("failing", 0, "validate");
  const validate = await readFile(join(cwd, validatePath), "utf8");
  await writeFile(join(cwd, validatePath), `${validate.replace("Decision:", "Decision: fail").replace("Gate:", "Gate: remediate").trimEnd()}\nFailure-Digest: ${failureEvidenceDigest(evidence)}\n`);
  await mkdir(join(cwd, remediationRecordPath("failing", 1), ".."), { recursive: true });
  await writeFile(join(cwd, remediationRecordPath("failing", 1)), `${JSON.stringify(record, null, 2)}\n`);
  await writeFile(join(cwd, attemptPhasePath("failing", 1, "implement")), "# implement\n\nGoal:\nEvidence:\nDecision:\nGate:\n");
  const { schemaVersion: _schemaVersion, workId: _workId, ...metadata } = record;
  const reopened: WorkState = { ...state, phase: "implement", gateCommit: prior, attempt: 1, remediation: metadata, updatedAt: timestamp };
  delete reopened.lastCompletedPhase;
  await saveState(cwd, reopened);
  await git.commit(await git.changedPaths(), "legacy validation remediation", { work: "failing", state: "remediated", attempt: "1" });
  return { cwd, git, prior };
}

async function expectTransition(cwd: string, git: GitRepository, source: "review" | "validate", target: RemediationTarget, prior: string): Promise<void> {
  const oldSource = await readFile(join(cwd, `.ways/sdd/failing/${source}.md`), "utf8");
  const hash = await remediateSdd(cwd, target, ` address ${source} failure `);
  const state = (await loadState(cwd))!;
  expect(state).toMatchObject({ phase: target, attempt: 1, gateCommit: prior, remediation: { source, target, attempt: 1, reason: `address ${source} failure` } });
  expect(state.lastCompletedPhase).toBeUndefined();
  const recordedSource = await readFile(join(cwd, `.ways/sdd/failing/${source}.md`), "utf8");
  expect(recordedSource).toContain(oldSource.trimEnd());
  if (source === "validate") expect(await readFile(join(cwd, validationFailureRecordPath("failing", 0)), "utf8")).toContain('"phase": "validate"');
  expect(await readFile(join(cwd, attemptPhasePath("failing", 1, target)), "utf8")).toContain(`# ${target}`);
  const record = JSON.parse(await readFile(join(cwd, remediationRecordPath("failing", 1)), "utf8"));
  expect(record).toMatchObject({ source, target, attempt: 1, priorCheckpoint: prior });
  expect(record.evidence.kind).toBe(source);
  const commit = await git.commitInfo(hash);
  expect(await git.parent(hash)).toBe(prior);
  expect(commit.trailers).toMatchObject({ work: "failing", phase: source, state: `remediated-${target}`, attempt: "1" });
}

describe("SDD remediation transitions", { timeout: 120_000 }, () => {
  for (const source of ["review", "validate"] as const) {
    for (const target of targets) {
      it(`${source} -> ${target} is additive and evidence gated`, async () => {
        const fixture = source === "review" ? await reviewRepository() : await validateRepository();
        await expectTransition(fixture.cwd, fixture.git, source, target, fixture.prior);
      });
    }
  }

  it.each([
    ["missing", undefined],
    ["malformed", "{"],
    ["passing", "pass"],
  ])("rejects %s review evidence without changing state", async (_label, evidence) => {
    const { cwd, git, reviewPath, prior } = await reviewRepository();
    if (evidence === undefined) await git.run(["clean", "-f", "--", reviewPath]);
    else if (evidence === "{") await writeFile(join(cwd, reviewPath), evidence);
    else {
      const review = JSON.parse(await readFile(join(cwd, reviewPath), "utf8"));
      await writeFile(join(cwd, reviewPath), JSON.stringify({ ...review, verdict: "pass" }));
    }
    await expect(remediateSdd(cwd, "implement", "fix it")).rejects.toThrow();
    expect(await git.head()).toBe(prior);
    expect((await loadState(cwd))?.attempt).toBeUndefined();
  });

  it.each(["review", "validate"] as const)("preserves genuine active %s failure evidence", async (source) => {
    const fixture = source === "review" ? await reviewRepository() : await validateRepository();
    const sourcePath = attemptPhasePath("failing", 0, source);
    const sourceArtifact = await readFile(join(fixture.cwd, sourcePath), "utf8");
    if (source === "review") expect(sourceArtifact).toMatch(/Goal: .+\nEvidence: .+\nDecision: fail\nGate: remediate/);

    const hash = await remediateSdd(fixture.cwd, "implement", `address ${source} failure`);

    const recordedSource = await readFile(join(fixture.cwd, sourcePath), "utf8");
    expect(recordedSource).toContain(sourceArtifact.trimEnd());
    if (source === "validate") expect(await readFile(join(fixture.cwd, validationFailureRecordPath("failing", 0)), "utf8")).toContain('"digest":');
    expect(await fixture.git.run(["show", `${hash}:${sourcePath}`])).toBe(recordedSource.trimEnd());
    const record = JSON.parse(await readFile(join(fixture.cwd, remediationRecordPath("failing", 1)), "utf8"));
    expect(record.evidence.kind).toBe(source);
    if (source === "review") {
      expect(record.evidence.review.verdict).toBe("fail");
      expect(await fixture.git.run(["show", `${hash}:${fixture.reviewPath}`])).toContain('"verdict": "fail"');
    } else {
      expect(record.evidence.failureRecord).toMatchObject({ commit: fixture.prior });
    }
  });

  it.each(["review", "validate"] as const)("rejects schema-valid detached %s failure evidence in the hook, history, and integrity", async (source) => {
    const fixture = source === "review" ? await reviewRepository() : await validateRepository();
    const state = (await loadState(fixture.cwd))!;
    const priorCheckpoint = await fixture.git.head();
    let evidence: RemediationEvidence;
    if (source === "review") {
      const reviewPath = join(fixture.cwd, fixture.reviewPath!);
      const review = JSON.parse(await readFile(reviewPath, "utf8"));
      review.digest = "0".repeat(64);
      await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`);
      evidence = { kind: "review", review };
    } else {
      evidence = {
        kind: "validate",
        failureRecord: {
          commit: "0".repeat(40),
          tree: "0".repeat(40),
          digest: "0".repeat(64),
        },
      };
    }
    const timestamp = new Date().toISOString();
    const record = {
      schemaVersion: 1 as const,
      workId: "failing",
      source,
      target: "implement" as const,
      reason: "fabricate failed evidence",
      evidence,
      priorCheckpoint,
      attempt: 1,
      timestamp,
    };
    const recordPath = join(fixture.cwd, remediationRecordPath("failing", 1));
    await mkdir(join(recordPath, ".."), { recursive: true });
    await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);
    const reopened: WorkState = {
      ...state,
      phase: "implement",
      gateCommit: priorCheckpoint,
      updatedAt: timestamp,
      attempt: 1,
      remediation: {
        source: record.source,
        target: record.target,
        reason: record.reason,
        evidence: record.evidence,
        priorCheckpoint: record.priorCheckpoint,
        attempt: record.attempt,
        timestamp: record.timestamp,
      },
    };
    delete reopened.lastCompletedPhase;
    await writeFile(join(fixture.cwd, attemptPhasePath("failing", 1, "implement")), "# implement\n\nGoal:\nEvidence:\nDecision:\nGate:\n");
    await saveState(fixture.cwd, reopened);
    await fixture.git.run(["add", "."]);
    const message = "fabricate remediation\n\nHarness-Work: failing\nHarness-Phase: " + source + "\nHarness-State: remediated-implement\nHarness-Attempt: 1";
    expect(await judgeCommitMessage(fixture.cwd, message)).toMatchObject({ accepted: false });
    await fixture.git.run(["commit", "-q", "--no-verify", "-m", "fabricate remediation", "-m", `Harness-Work: failing\nHarness-Phase: ${source}\nHarness-State: remediated-implement\nHarness-Attempt: 1`]);
    expect((await checkHistory(fixture.cwd)).map((issue) => issue.code)).toContain("history-invalid-remediation-evidence");
    expect((await checkIntegrity(fixture.cwd)).map((issue) => issue.code)).toContain("state-git-divergence");
  });

  it("commits replayable validation results before linking them into remediation", async () => {
    const { cwd, git, prior } = await validateRepository();
    const path = validationFailureRecordPath("failing", 0);
    const failure = JSON.parse(await readFile(join(cwd, path), "utf8"));
    expect(failure).toMatchObject({ workId: "failing", attempt: 0, phase: "validate", inputCommit: await git.parent(prior) });
    expect(failure.inputTree).toBe(await git.run(["rev-parse", `${failure.inputCommit}^{tree}`]));
    expect(await checkHistory(cwd)).toEqual([]);
    expect(await checkIntegrity(cwd)).toEqual([]);

    await remediateSdd(cwd, "implement", "link replayable failure");
    const transition = JSON.parse(await readFile(join(cwd, remediationRecordPath("failing", 1)), "utf8"));
    expect(transition.evidence).toMatchObject({ kind: "validate", failureRecord: { commit: prior, digest: failure.digest } });
    expect(await readFile(join(cwd, attemptPhasePath("failing", 0, "validate")), "utf8")).not.toContain("Failure-Digest:");
  });

  it("rejects forged validation digests and transition-only validation evidence", async () => {
    const { cwd, git, prior } = await validateRepository();
    const path = validationFailureRecordPath("failing", 0);
    const forged = JSON.parse(await readFile(join(cwd, path), "utf8"));
    forged.digest = "0".repeat(64);
    await writeFile(join(cwd, path), `${JSON.stringify(forged, null, 2)}\n`);
    await git.run(["add", path]);
    await git.run(["commit", "-q", "--no-verify", "--amend", "--no-edit"]);
    expect((await checkHistory(cwd)).map((issue) => issue.code)).toContain("history-invalid-validation-failure");
    await expect(remediateSdd(cwd, "implement", "link forged failure")).rejects.toThrow(/validation failure record/);
    expect(await git.head()).not.toBe(prior);
  });

  it("replays staged failure results in the hook and history instead of accepting self-attestation", async () => {
    const { cwd, git } = await validateRepository();
    const path = validationFailureRecordPath("failing", 0);
    await git.run(["reset", "--soft", "HEAD^"]);
    const forged = JSON.parse(await readFile(join(cwd, path), "utf8"));
    forged.checks.testExitCode = 8;
    forged.digest = validationFailureDigest({ ...forged, digest: undefined });
    await writeFile(join(cwd, path), `${JSON.stringify(forged, null, 2)}\n`);
    await git.run(["add", path]);
    const message = "record validation failure\n\nHarness-Work: failing\nHarness-Phase: validate\nHarness-State: validation-failed";
    expect(await judgeCommitMessage(cwd, message)).toMatchObject({ accepted: false, reason: expect.stringMatching(/cannot be reproduced/) });
    await git.run(["commit", "-q", "--no-verify", "-m", "record validation failure", "-m", "Harness-Work: failing\nHarness-Phase: validate\nHarness-State: validation-failed"]);
    expect((await checkHistory(cwd)).map((issue) => issue.code)).toContain("history-invalid-validation-failure");
  });

  it("rejects wrong validation inputs, extra paths, and malformed failure trailers", async () => {
    const wrongInput = await validateRepository();
    const path = validationFailureRecordPath("failing", 0);
    const record = JSON.parse(await readFile(join(wrongInput.cwd, path), "utf8"));
    record.inputTree = "0".repeat(40);
    record.digest = validationFailureDigest({ ...record, digest: undefined });
    await writeFile(join(wrongInput.cwd, path), `${JSON.stringify(record, null, 2)}\n`);
    await wrongInput.git.run(["add", path]);
    await wrongInput.git.run(["commit", "-q", "--no-verify", "--amend", "--no-edit"]);
    expect((await checkHistory(wrongInput.cwd)).map((issue) => issue.code)).toContain("history-invalid-validation-failure");

    const wrongCommit = await validateRepository();
    const wrongCommitRecord = JSON.parse(await readFile(join(wrongCommit.cwd, path), "utf8"));
    wrongCommitRecord.inputCommit = await wrongCommit.git.parent(wrongCommitRecord.inputCommit);
    wrongCommitRecord.digest = validationFailureDigest({ ...wrongCommitRecord, digest: undefined });
    await wrongCommit.git.run(["reset", "--soft", "HEAD^"]);
    await writeFile(join(wrongCommit.cwd, path), `${JSON.stringify(wrongCommitRecord, null, 2)}\n`);
    await wrongCommit.git.run(["add", path]);
    expect(await judgeCommitMessage(wrongCommit.cwd, "record validation failure\n\nHarness-Work: failing\nHarness-Phase: validate\nHarness-State: validation-failed")).toMatchObject({ accepted: false, reason: expect.stringMatching(/does not bind/) });
    await wrongCommit.git.run(["commit", "-q", "--no-verify", "-m", "record validation failure", "-m", "Harness-Work: failing\nHarness-Phase: validate\nHarness-State: validation-failed"]);
    expect((await checkHistory(wrongCommit.cwd)).map((issue) => issue.code)).toContain("history-invalid-validation-failure");

    const extraPath = await validateRepository();
    await extraPath.git.run(["reset", "--soft", "HEAD^"]);
    await writeFile(join(extraPath.cwd, "extra.txt"), "not validation evidence\n");
    await extraPath.git.run(["add", "extra.txt"]);
    expect(await judgeCommitMessage(extraPath.cwd, "record validation failure\n\nHarness-Work: failing\nHarness-Phase: validate\nHarness-State: validation-failed")).toMatchObject({ accepted: false, reason: expect.stringMatching(/stage only/) });
    await extraPath.git.run(["commit", "-q", "--no-verify", "-m", "record validation failure", "-m", "Harness-Work: failing\nHarness-Phase: validate\nHarness-State: validation-failed"]);
    expect((await checkHistory(extraPath.cwd)).map((issue) => issue.code)).toContain("history-invalid-validation-failure");

    const trailers = await validateRepository();
    expect(await judgeCommitMessage(trailers.cwd, "record validation failure\n\nHarness-Work: failing\nHarness-Phase: review\nHarness-State: validation-failed")).toMatchObject({ accepted: false, reason: expect.stringMatching(/trailers/) });
    await trailers.git.run(["commit", "-q", "--no-verify", "--amend", "-m", "record validation failure", "-m", "Harness-Work: failing\nHarness-Phase: review\nHarness-State: validation-failed"]);
    expect((await checkHistory(trailers.cwd)).map((issue) => issue.code)).toContain("history-invalid-validation-failure");
  });

  it("rejects remediation validation evidence that does not link its parent failure commit", async () => {
    const { cwd, git, prior } = await validateRepository();
    await remediateSdd(cwd, "implement", "link failure");
    const path = remediationRecordPath("failing", 1);
    const record = JSON.parse(await readFile(join(cwd, path), "utf8"));
    record.evidence.failureRecord.commit = await git.parent(prior);
    record.evidence.failureRecord.tree = await git.run(["rev-parse", `${record.evidence.failureRecord.commit}^{tree}`]);
    await writeFile(join(cwd, path), `${JSON.stringify(record, null, 2)}\n`);
    await git.run(["add", path]);
    await git.run(["commit", "-q", "--no-verify", "--amend", "--no-edit"]);
    expect((await checkHistory(cwd)).map((issue) => issue.code)).toContain("history-invalid-remediation-evidence");
  });

  it("replays supported legacy remediated transitions from their committed record", async () => {
    const { cwd, git, prior, reviewPath } = await reviewRepository();
    const state = (await loadState(cwd))!;
    const review = JSON.parse(await readFile(join(cwd, reviewPath), "utf8"));
    const timestamp = new Date().toISOString();
    const record = {
      schemaVersion: 1,
      workId: "failing",
      source: "review" as const,
      target: "implement" as const,
      reason: "legacy remediation",
      evidence: { kind: "review" as const, review },
      priorCheckpoint: prior,
      attempt: 1,
      timestamp,
    };
    await mkdir(join(cwd, remediationRecordPath("failing", 1), ".."), { recursive: true });
    await writeFile(join(cwd, remediationRecordPath("failing", 1)), `${JSON.stringify(record, null, 2)}\n`);
    await writeFile(join(cwd, attemptPhasePath("failing", 1, "implement")), "# implement\n\nGoal:\nEvidence:\nDecision:\nGate:\n");
    const { schemaVersion: _schemaVersion, workId: _workId, ...metadata } = record;
    const reopened: WorkState = {
      ...state, phase: "implement", gateCommit: prior, attempt: 1,
      remediation: metadata, updatedAt: timestamp,
    };
    delete reopened.lastCompletedPhase;
    await saveState(cwd, reopened);
    await git.commit(await git.changedPaths(), "legacy remediation", { work: "failing", state: "remediated", attempt: "1" });
    expect(await checkHistory(cwd)).toEqual([]);
    expect(await checkIntegrity(cwd)).toEqual([]);
  });

  it("accepts a reproducible legacy inline validation remediation while retaining prior-artifact protection", async () => {
    const legacy = await legacyValidationTransition();
    const record = JSON.parse(await readFile(join(legacy.cwd, remediationRecordPath("failing", 1)), "utf8"));
    expect(await remediationEvidenceFailure(legacy.git, record, legacy.prior, await legacy.git.head())).toBeUndefined();
    await expect(assertSddConsistency(legacy.cwd, (await loadState(legacy.cwd))!)).resolves.toBeUndefined();
    expect(await checkHistory(legacy.cwd)).toEqual([]);
    expect(await checkIntegrity(legacy.cwd)).toEqual([]);

    await writeFile(join(legacy.cwd, attemptPhasePath("failing", 0, "review")), "forged prior artifact\n");
    await legacy.git.run(["add", ".ways/sdd/failing/review.md"]);
    await legacy.git.run(["commit", "-q", "--no-verify", "--amend", "--no-edit"]);
    expect((await checkHistory(legacy.cwd)).map((issue) => issue.code)).toContain("history-prior-artifact-mutated");
  });

  it("rejects forged legacy validation failure strings in remediation, consistency, history, and integrity", async () => {
    const legacy = await legacyValidationTransition();
    const recordPath = remediationRecordPath("failing", 1);
    const record = JSON.parse(await readFile(join(legacy.cwd, recordPath), "utf8"));
    record.evidence.failures[0].detail = "Configured test command exited with status 8";
    const validatePath = attemptPhasePath("failing", 0, "validate");
    const validate = await readFile(join(legacy.cwd, validatePath), "utf8");
    await writeFile(join(legacy.cwd, recordPath), `${JSON.stringify(record, null, 2)}\n`);
    await writeFile(join(legacy.cwd, validatePath), validate.replace(/Failure-Digest:.+/, `Failure-Digest: ${failureEvidenceDigest(record.evidence)}`));
    const state = (await loadState(legacy.cwd))!;
    state.remediation!.evidence = record.evidence;
    await saveState(legacy.cwd, state);
    await legacy.git.run(["add", recordPath, validatePath, ".ways/state/current.json", ".ways/status.json"]);
    await legacy.git.run(["commit", "-q", "--no-verify", "--amend", "--no-edit"]);

    expect(await remediationEvidenceFailure(legacy.git, record, legacy.prior, await legacy.git.head())).toMatch(/cannot be reproduced/);
    await expect(assertSddConsistency(legacy.cwd, (await loadState(legacy.cwd))!)).rejects.toThrow(/cannot be reproduced/);
    expect((await checkHistory(legacy.cwd)).map((issue) => issue.code)).toContain("history-invalid-remediation-evidence");
    expect((await checkIntegrity(legacy.cwd)).map((issue) => issue.code)).toContain("state-git-divergence");
  });

  it.each(["missing", "mismatched", "duplicate"] as const)("rejects %s legacy Failure-Digest in remediation, consistency, history, and integrity", async (kind) => {
    const legacy = await legacyValidationTransition();
    const validatePath = attemptPhasePath("failing", 0, "validate");
    const validate = await readFile(join(legacy.cwd, validatePath), "utf8");
    const evidenceDigest = failureEvidenceDigest(JSON.parse(await readFile(join(legacy.cwd, remediationRecordPath("failing", 1)), "utf8")).evidence);
    await writeFile(join(legacy.cwd, validatePath), kind === "missing"
      ? validate.replace(/^Failure-Digest:.*\n/m, "")
      : kind === "mismatched"
        ? validate.replace(/Failure-Digest:.+/, `Failure-Digest: ${"0".repeat(64)}`)
        : `${validate.trimEnd()}\nFailure-Digest: ${evidenceDigest}\n`);
    await legacy.git.run(["add", validatePath]);
    await legacy.git.run(["commit", "-q", "--no-verify", "--amend", "--no-edit"]);
    const record = JSON.parse(await readFile(join(legacy.cwd, remediationRecordPath("failing", 1)), "utf8"));

    expect(await remediationEvidenceFailure(legacy.git, record, legacy.prior, await legacy.git.head())).toMatch(/not bound/);
    await expect(assertSddConsistency(legacy.cwd, (await loadState(legacy.cwd))!)).rejects.toThrow(/not bound/);
    expect((await checkHistory(legacy.cwd)).map((issue) => issue.code)).toContain("history-invalid-remediation-evidence");
    expect((await checkIntegrity(legacy.cwd)).map((issue) => issue.code)).toContain("state-git-divergence");
  });

  it("rejects legacy validation remediation not bound to its direct parent input", async () => {
    const legacy = await legacyValidationTransition();
    const recordPath = remediationRecordPath("failing", 1);
    const record = JSON.parse(await readFile(join(legacy.cwd, recordPath), "utf8"));
    record.priorCheckpoint = await legacy.git.parent(legacy.prior);
    await writeFile(join(legacy.cwd, recordPath), `${JSON.stringify(record, null, 2)}\n`);
    const state = (await loadState(legacy.cwd))!;
    state.remediation!.priorCheckpoint = record.priorCheckpoint;
    state.gateCommit = record.priorCheckpoint;
    await saveState(legacy.cwd, state);
    await legacy.git.run(["add", recordPath, ".ways/state/current.json", ".ways/status.json"]);
    await legacy.git.run(["commit", "-q", "--no-verify", "--amend", "--no-edit"]);

    expect(await remediationEvidenceFailure(legacy.git, record, legacy.prior, await legacy.git.head())).toMatch(/does not bind/);
    await expect(assertSddConsistency(legacy.cwd, (await loadState(legacy.cwd))!)).rejects.toThrow(/transition identity does not match/);
    expect((await checkHistory(legacy.cwd)).map((issue) => issue.code)).toContain("history-invalid-remediation-evidence");
    expect((await checkIntegrity(legacy.cwd)).map((issue) => issue.code)).toContain("state-git-divergence");
  });

  it("does not exempt prior validation artifacts from recorded-validation remediation", async () => {
    const { cwd, git } = await validateRepository();
    await remediateSdd(cwd, "implement", "preserve recorded validation evidence");
    const path = attemptPhasePath("failing", 0, "validate");
    await writeFile(join(cwd, path), "forged legacy-style validation artifact\n");
    await git.run(["add", path]);
    await git.run(["commit", "-q", "--no-verify", "--amend", "--no-edit"]);
    expect((await checkHistory(cwd)).map((issue) => issue.code)).toContain("history-prior-artifact-mutated");
  });

  it("prunes detached replay metadata when checks damage the replay worktree", async () => {
    const testCommand = [process.execPath, "-e", "require('node:fs').rmSync('.git'); process.exit(7);"];
    const { git } = await baseRepository(0, testCommand);
    const inputCommit = await git.head();
    const record: ValidationFailureRecord = {
      schemaVersion: 1,
      workId: "failing",
      attempt: 0,
      phase: "validate",
      inputCommit,
      inputTree: await git.run(["rev-parse", "HEAD^{tree}"]),
      testCommand,
      checks: { integrity: [], testExitCode: 7 },
      digest: "0".repeat(64),
    };
    expect(await validationFailureReplayFailure(git, record)).toBeUndefined();
    expect(await git.run(["worktree", "list", "--porcelain"])).not.toContain("validation-replay-");
  });

  it("records failed checks through the CLI and preserves the passing validate path", async () => {
    const failing = await validateRepository();
    await failing.git.run(["reset", "--hard", "HEAD^"]);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await run(["sdd", "validate"], failing.cwd)).toBe(1);
    } finally {
      error.mockRestore();
    }
    expect(await readFile(join(failing.cwd, validationFailureRecordPath("failing", 0)), "utf8")).toContain('"testExitCode": 7');

    const passing = await validateRepository(0);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      expect(await run(["sdd", "validate"], passing.cwd)).toBe(0);
      expect(log).toHaveBeenCalledWith("SDD validation passed.");
    } finally {
      log.mockRestore();
    }
  });

  it("requires remediation before a same-attempt passing validation can advance through the API or CLI", async () => {
    const { cwd, git } = await validateRepository();
    const configPath = ".ways/config.json";
    const config = JSON.parse(await readFile(join(cwd, configPath), "utf8"));
    config.testCommand = [process.execPath, "-e", "process.exit(0)"];
    await writeFile(join(cwd, configPath), `${JSON.stringify(config, null, 2)}\n`);
    await git.commit([configPath], "make validation pass", { work: "failing" });
    const head = await git.head();

    await expect(advanceSdd(cwd)).rejects.toThrow(/validation failure requires remediation/i);
    await expect(run(["sdd", "advance"], cwd)).rejects.toThrow(/validation failure requires remediation/i);
    expect(await git.head()).toBe(head);
    expect((await loadState(cwd))?.phase).toBe("validate");
  });

  it("rejects a no-verify completed validation after a recorded failure in history and active consistency", async () => {
    const { cwd, git } = await validateRepository();
    const state = (await loadState(cwd))!;
    state.phase = "reconcile-memory";
    state.lastCompletedPhase = "validate";
    state.gateCommit = await git.head();
    state.updatedAt = new Date().toISOString();
    await writeFile(join(cwd, attemptPhasePath("failing", 0, "reconcile-memory")), "# reconcile-memory\n\nGoal:\nEvidence:\nDecision:\nGate:\n");
    await saveState(cwd, state);
    await git.run(["add", "."]);
    await git.run(["commit", "-q", "--no-verify", "-m", "forge passing validation", "-m", "Harness-Work: failing\nHarness-Phase: validate\nHarness-State: completed"]);

    expect((await checkHistory(cwd)).map((issue) => issue.code)).toContain("history-broken-chain");
    await expect(assertSddConsistency(cwd, (await loadState(cwd))!)).rejects.toThrow(/validation failure requires remediation/i);
    expect((await checkIntegrity(cwd)).map((issue) => issue.code)).toContain("state-git-divergence");
  });

  it("permits initial passing validation when no failure record exists", async () => {
    const { cwd } = await validateRepository(0);
    const path = join(cwd, attemptPhasePath("failing", 0, "validate"));
    const content = await readFile(path, "utf8");
    await writeFile(path, content.replace("Goal:", "Goal: validate").replace("Evidence:", "Evidence: checks pass"));

    await expect(advanceSdd(cwd)).resolves.toBeTruthy();
    expect((await loadState(cwd))?.phase).toBe("reconcile-memory");
  });

  it("opens a remediation from the CLI and projects its attempt in status", async () => {
    const { cwd } = await reviewRepository();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      expect(await run(["sdd", "remediate", "implement", "--reason=address review findings"], cwd)).toBe(0);
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/^SDD remediation opened: .+ \(attempt 1, review -> implement\)\.$/));
    } finally {
      log.mockRestore();
    }
    expect((await loadState(cwd))?.attempt).toBe(1);
    await expect((await import("../src/state/status.js")).readStatus(cwd)).resolves.toMatchObject({
      attempt: 1, remediation: { source: "review", target: "implement", reason: "address review findings" },
    });
    await expect(run(["sdd", "remediate", "implement"], cwd)).rejects.toThrow(/Usage: ways sdd remediate/);
  });

  it("rejects stale review evidence and unrelated staged or dirty content without mutation", async () => {
    const { cwd, git, prior } = await reviewRepository();
    await writeFile(join(cwd, "implementation.ts"), "export const value = 2;\n");
    await expect(remediateSdd(cwd, "implement", "fix it")).rejects.toThrow(/stale/);
    expect(await git.head()).toBe(prior);
    await git.run(["checkout", "--", "implementation.ts"]);
    await writeFile(join(cwd, "unrelated.txt"), "no\n");
    await git.run(["add", "unrelated.txt"]);
    await expect(remediateSdd(cwd, "implement", "fix it")).rejects.toThrow();
    expect(await git.head()).toBe(prior);
    expect((await loadState(cwd))?.attempt).toBeUndefined();
  });

  it.each([
    ["previously certified artifact", ".ways/sdd/failing/review.md", false],
    ["staged production", "implementation.ts", true],
    ["other dirty content", "unrelated.txt", false],
  ] as const)("rejects %s even with a committed validation failure record", async (_label, path, staged) => {
    const { cwd, git, prior } = await validateRepository();
    await writeFile(join(cwd, path), "unrelated mutation\n");
    if (staged) await git.run(["add", path]);

    await expect(remediateSdd(cwd, "implement", "fix validation")).rejects.toThrow(/Unrelated dirty or staged content/);
    expect(await git.head()).toBe(prior);
    expect((await loadState(cwd))?.attempt).toBeUndefined();
  });

  it("moves reopened phases forward to fresh attempt-scoped review and validation", async () => {
    const { cwd } = await reviewRepository();
    await remediateSdd(cwd, "specify", "revise requirements");
    for (const phase of ["specify", "plan", "decompose", "implement"] as const) {
      const path = join(cwd, attemptPhasePath("failing", 1, phase));
      const content = await readFile(path, "utf8");
      await writeFile(path, content.replace("Goal:", "Goal: continue").replace("Evidence:", "Evidence: current attempt"));
      await advanceSdd(cwd);
    }
    expect((await loadState(cwd))?.phase).toBe("review");
    const reviewPhase = join(cwd, attemptPhasePath("failing", 1, "review"));
    const content = await readFile(reviewPhase, "utf8");
    await writeFile(reviewPhase, content.replace("Goal:", "Goal: review").replace("Evidence:", "Evidence: fresh pass"));
    const input = join(await mkdtemp(join(tmpdir(), "ways-review-input-")), "fresh-review.json");
    await writeFile(input, JSON.stringify({
      schemaVersion: 1, workId: "failing", attempt: 1, reviewer: "fresh reviewer",
      digest: await reviewDigest(cwd), verdict: "pass", findings: [],
    }));
    await submitReview(cwd, input);
    await advanceSdd(cwd);
    expect((await loadState(cwd))?.phase).toBe("validate");
    expect(await readFile(join(cwd, attemptPhasePath("failing", 1, "validate")), "utf8")).toContain("# validate");
  });

  it("requires a fresh attempt-scoped approval at a reopened supervised plan gate", async () => {
    const { cwd } = await reviewRepository("supervised");
    await remediateSdd(cwd, "plan", "revise plan");
    const path = join(cwd, attemptPhasePath("failing", 1, "plan"));
    const content = await readFile(path, "utf8");
    await writeFile(path, content.replace("Goal:", "Goal: plan again").replace("Evidence:", "Evidence: review failure"));
    await expect(advanceSdd(cwd)).rejects.toThrow(/human approval/);
    await approveInteractively(cwd, { interactive: true, ask: async () => "plan", say: () => undefined });
    await expect(advanceSdd(cwd)).resolves.toBeTruthy();
    expect((await loadState(cwd))?.phase).toBe("decompose");
  });

  it("rejects passing validation and empty reasons without mutation", async () => {
    const passing = await validateRepository(0);
    await expect(remediateSdd(passing.cwd, "implement", "fix it")).rejects.toThrow(/committed validation failure record/);
    expect(await passing.git.head()).toBe(passing.prior);
    expect((await loadState(passing.cwd))?.attempt).toBeUndefined();

    await expect(remediateSdd(passing.cwd, "implement", "   ")).rejects.toThrow(/nonempty/);
    expect(await passing.git.head()).toBe(passing.prior);
  });
});
