import { spawn } from "node:child_process";
import { loadConfig } from "../config/config.js";
import { checkIntegrity, type IntegrityIssue } from "../integrity/integrity.js";

export interface CheckResult {
  issues: IntegrityIssue[];
  testExitCode?: number;
}

function execute(command: string[], cwd: string): Promise<number> {
  const [program, ...args] = command;
  if (!program) throw new Error("Configured test command is empty");
  return new Promise((resolve, reject) => {
    // Detached so the whole tree (npm -> vitest -> workers) can be killed
    // as one group when the runner dies early (SIGPIPE from `| head`,
    // tool timeouts, Ctrl-C). Otherwise orphaned workers keep burning CPU
    // under PID 1. Thread-pool vitest workers die with the parent anyway.
    const child = spawn(program, args, { cwd, stdio: "inherit", shell: false, detached: process.platform !== "win32" });
    const killTree = (signal: NodeJS.Signals): void => {
      try {
        if (child.pid !== undefined && process.platform !== "win32") process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          // Already exited.
        }
      }
    };
    const cleanup = (): void => {
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
      process.removeListener("exit", onExit);
    };
    const onSigint = (): void => killTree("SIGINT");
    const onSigterm = (): void => killTree("SIGTERM");
    const onExit = (): void => killTree("SIGTERM");
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    process.once("exit", onExit);
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("exit", (code) => {
      cleanup();
      resolve(code ?? 1);
    });
  });
}

export async function runChecks(cwd: string, integrityOnly = false): Promise<CheckResult> {
  const issues = await checkIntegrity(cwd);
  if (issues.length > 0 || integrityOnly) return { issues };
  const config = await loadConfig(cwd);
  return { issues, testExitCode: await execute(config.testCommand, cwd) };
}
