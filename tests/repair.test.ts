import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { bootstrap } from "../src/bootstrap/bootstrap.js";
import { GitRepository } from "../src/git/git.js";
import { adoptHead, diagnose, rollbackToLastGate } from "../src/repair/repair.js";
import { loadState, saveState } from "../src/state/store.js";
import { implementationDigest } from "../src/work/digest.js";
import { remediateSdd } from "../src/work/remediation.js";
import { submitReview } from "../src/work/review.js";
import { advanceSdd, startSdd } from "../src/work/sdd.js";

it("repairs an explicit SDD state divergence from certified Git history", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "ways-repair-"));
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
  await startSdd(cwd, "repair-work", "autonomous");
  const packet = join(cwd, ".ways/sdd/repair-work/intake.md");
  await writeFile(packet, (await readFile(packet, "utf8")).replace("Goal:", "Goal: repair").replace("Evidence:", "Evidence: test"));
  await advanceSdd(cwd);
  const state = (await loadState(cwd))!;
  state.gateCommit = "0000000";
  await saveState(cwd, state);
  expect((await diagnose(cwd)).consistent).toBe(false);
  await adoptHead(cwd);
  expect((await diagnose(cwd)).consistent).toBe(true);
});

it("adopts and rolls back to the latest additive remediation checkpoint", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "ways-repair-remediation-"));
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
  await startSdd(cwd, "repair-loop", "autonomous");
  for (const phase of ["intake", "explore", "assess", "specify", "plan", "decompose", "implement"]) {
    const path = join(cwd, ".ways/sdd/repair-loop", `${phase}.md`);
    await writeFile(path, `# ${phase}\nGoal: repair\nEvidence: test\n`);
    await advanceSdd(cwd);
  }
  const reviewState = (await loadState(cwd))!;
  const reviewInput = join(await mkdtemp(join(tmpdir(), "ways-review-input-")), "review.json");
  await writeFile(reviewInput, `${JSON.stringify({
    schemaVersion: 1, workId: "repair-loop", reviewer: "reviewer",
    digest: await implementationDigest(cwd, reviewState), verdict: "fail",
    findings: [{ id: "x", severity: "high", summary: "fix", disposition: "open" }],
  })}\n`);
  await submitReview(cwd, reviewInput);
  const transition = await remediateSdd(cwd, "implement", "repair finding");
  const state = (await loadState(cwd))!;
  state.gateCommit = "corrupt";
  delete state.remediation;
  await saveState(cwd, state);

  expect(await adoptHead(cwd)).toMatchObject({ attempt: 1, phase: "implement", gateCommit: expect.not.stringMatching(/corrupt/), remediation: { target: "implement", attempt: 1 } });
  await writeFile(join(cwd, "later.txt"), "later\n");
  await git.run(["add", "later.txt"]);
  await git.run(["commit", "-q", "--no-verify", "-m", "task", "-m", "Harness-Work: repair-loop\nHarness-Task: later\nHarness-Attempt: 1"]);
  expect(await rollbackToLastGate(cwd, true)).toBe(transition);
  expect(await git.head()).toBe(transition);
  expect(await loadState(cwd)).toMatchObject({ attempt: 1, phase: "implement", remediation: { target: "implement" } });
});
