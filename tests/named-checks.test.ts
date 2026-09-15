import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bootstrap } from "../src/bootstrap/bootstrap.js";
import { runChecks } from "../src/check/check.js";
import { validateConfig } from "../src/domain/validation.js";
import { GitRepository } from "../src/git/git.js";
import type { ValidationFailureRecord } from "../src/domain/types.js";
import { validationFailureDigest, validationFailureReplayFailure } from "../src/work/validation-failure.js";

async function repository(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "ways-named-checks-"));
  const git = new GitRepository(cwd);
  await git.run(["init", "-q"]);
  await git.run(["config", "user.name", "Ways Test"]);
  await git.run(["config", "user.email", "ways@example.test"]);
  await writeFile(join(cwd, ".gitkeep"), "");
  await git.run(["add", ".gitkeep"]);
  await git.run(["commit", "-q", "-m", "initial"]);
  return cwd;
}

const pass = [process.execPath, "-e", "process.exit(0)"];

describe("named environment checks", () => {
  it("validates the additive contract and records deterministic named results", async () => {
    const cwd = await repository();
    await bootstrap({
      cwd,
      testCommand: pass,
      adapters: false,
      commands: {
        required: ["lint", "test"],
        test: pass,
        lint: [process.execPath, "-e", "process.exit(3)"],
      },
    });
    const result = await runChecks(cwd);
    expect(result.checks?.map(({ name, status }) => [name, status])).toEqual([
      ["test", "passed"],
      ["lint", "failed"],
      ["typecheck", "skipped"],
      ["build", "skipped"],
      ["e2e", "skipped"],
    ]);
    expect(result.testExitCode).toBe(1);
  });

  it("distinguishes unavailable required commands and bounded timeouts", async () => {
    const cwd = await repository();
    await bootstrap({
      cwd,
      testCommand: pass,
      adapters: false,
      commands: {
        required: ["test", "lint"],
        // Exercise the real child-process timeout and process-tree cleanup boundary.
        test: [process.execPath, "-e", "setTimeout(() => {}, 1000)"],
        lint: ["ways-command-that-does-not-exist"],
        timeoutMs: 30,
      },
    });
    const result = await runChecks(cwd);
    expect(result.checks?.find((check) => check.name === "test")?.status).toBe("timed-out");
    expect(result.checks?.find((check) => check.name === "lint")?.status).toBe("unavailable");
  });

  it("replays the recorded named contract after current configuration changes", async () => {
    const cwd = await repository();
    const git = new GitRepository(cwd);
    const failingLint = [process.execPath, "-e", "process.exit(4)"];
    const passingLint = [process.execPath, "-e", "process.exit(0)"];
    const commands = { required: ["test", "lint"] as const, test: pass, lint: failingLint };
    await bootstrap({ cwd, testCommand: pass, adapters: false, commands });
    await git.run(["add", "."]);
    await git.run(["commit", "-q", "-m", "bootstrap"]);
    const inputCommit = await git.head();
    const result = await runChecks(cwd);
    const recordWithoutDigest = {
      schemaVersion: 1 as const,
      workId: "named-replay",
      attempt: 0,
      phase: "validate" as const,
      inputCommit,
      inputTree: await git.run(["rev-parse", "HEAD^{tree}"]),
      testCommand: pass,
      commands,
      checks: {
        integrity: result.issues,
        testExitCode: result.testExitCode,
        named: result.checks,
      },
    };
    const record: ValidationFailureRecord = {
      ...recordWithoutDigest,
      digest: validationFailureDigest(recordWithoutDigest),
    };
    const configPath = join(cwd, ".ways/config.json");
    const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    config.commands = { ...commands, lint: passingLint };
    await writeFile(configPath, `${JSON.stringify(config)}\\n`);
    expect(await validationFailureReplayFailure(git, record)).toBeUndefined();
  });

  it("rejects empty or unknown commands while accepting legacy configuration", () => {
    expect(validateConfig({ schemaVersion: 1, harnessVersion: "test", testCommand: ["true"] })).toBe(true);
    expect(validateConfig({
      schemaVersion: 1,
      harnessVersion: "test",
      testCommand: ["true"],
      commands: { required: ["test"], test: [] },
    })).toBe(false);
    expect(validateConfig({
      schemaVersion: 1,
      harnessVersion: "test",
      testCommand: ["true"],
      commands: { required: ["unknown"], test: ["true"] },
    })).toBe(false);
  });
});
