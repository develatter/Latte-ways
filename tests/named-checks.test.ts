import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { bootstrap } from "../src/bootstrap/bootstrap.js";
import { runChecks, treeKillArgs } from "../src/check/check.js";
import { validateConfig } from "../src/domain/validation.js";
import { GitRepository } from "../src/git/git.js";
import type { ValidationFailureRecord } from "../src/domain/types.js";
import { validationFailureDigest, validationFailureRecordFailure, validationFailureReplayFailure } from "../src/work/validation-failure.js";

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

  it("accepts integrity failures when named commands were skipped", () => {
    const withoutDigest = {
      schemaVersion: 1 as const,
      workId: "integrity-record",
      attempt: 0,
      phase: "validate" as const,
      inputCommit: "a".repeat(40),
      inputTree: "b".repeat(40),
      testCommand: pass,
      commands: { required: ["test"] as const, test: pass },
      checks: {
        integrity: [{ code: "integrity-error", path: "AGENTS.md", message: "changed" }],
        testExitCode: 1,
        named: [{ name: "test" as const, status: "skipped" as const, command: pass, detail: "Skipped because integrity checks failed" }],
      },
    };
    const record: ValidationFailureRecord = { ...withoutDigest, digest: validationFailureDigest(withoutDigest) };
    expect(validationFailureRecordFailure(record)).toBeUndefined();
  });

  it("terminates the harness on interruption without running later checks", async () => {
    const cwd = await repository();
    const marker = join(cwd, "later-check-ran");
    await bootstrap({
      cwd,
      testCommand: pass,
      adapters: false,
      commands: {
        required: ["test", "lint"],
        test: [process.execPath, "-e", "setTimeout(() => {}, 5000)"],
        lint: [process.execPath, "-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`],
      },
    });
    const script = `import { runChecks } from ${JSON.stringify(new URL("../dist/check/check.js", import.meta.url).href)}; await runChecks(${JSON.stringify(cwd)});`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { cwd, stdio: ["ignore", "ignore", "pipe"] });
    const exit = once(child, "exit") as Promise<[number | null, NodeJS.Signals | null]>;
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    await new Promise((resolve) => setTimeout(resolve, 100));
    child.kill("SIGTERM");
    const [code, signal] = await exit;
    if (code !== null) throw new Error(stderr || `child exited ${code}`);
    expect(code).toBeNull();
    expect(signal).toBe("SIGTERM");
    await expect(readFile(marker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uses Windows taskkill tree arguments without requiring a Windows host", () => {
    expect(treeKillArgs(42, "SIGTERM", "win32")).toEqual(["/PID", "42", "/T"]);
    expect(treeKillArgs(42, "SIGKILL", "win32")).toEqual(["/PID", "42", "/T", "/F"]);
    expect(treeKillArgs(42, "SIGTERM", "darwin")).toBeUndefined();
  });

  it("bootstraps legacy whitespace arguments unchanged", async () => {
    const cwd = await repository();
    await expect(bootstrap({ cwd, testCommand: [process.execPath, "-e", " "], adapters: false })).resolves.toBeDefined();
  });

  it("rejects every present invalid commands option", async () => {
    for (const option of ["--commands=", "--commands=null", "--commands=false", "--commands=0"]) {
      const cwd = await repository();
      await expect(run(["bootstrap", "--no-adapters", option], cwd)).rejects.toThrow();
    }
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
    expect(validateConfig({ schemaVersion: 1, harnessVersion: "test", testCommand: [" "] })).toBe(true);
    expect(validateConfig({ schemaVersion: 1, harnessVersion: "test", testCommand: ["bad\0"] })).toBe(true);
    expect(validateConfig({
      schemaVersion: 1,
      harnessVersion: "test",
      testCommand: ["true"],
      commands: { required: ["test"], test: ["bad\0"] },
    })).toBe(false);
  });
});
