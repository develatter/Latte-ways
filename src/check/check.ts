import { spawn, type ChildProcess } from "node:child_process";
import { loadConfig } from "../config/config.js";
import { CHECK_NAMES, type CheckName, type NamedCheckResult, type NamedChecksConfig } from "../domain/types.js";
import { checkIntegrity, type IntegrityIssue } from "../integrity/integrity.js";

export interface CheckResult {
  issues: IntegrityIssue[];
  testExitCode?: number;
  checks?: NamedCheckResult[];
}

interface ExecutionResult {
  status: "passed" | "failed" | "timed-out" | "unavailable";
  exitCode?: number;
  detail?: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;

function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (child.pid !== undefined && process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The child already exited.
    }
  }
}

function execute(command: string[], cwd: string, timeoutMs: number): Promise<ExecutionResult> {
  const [program, ...args] = command;
  if (!program || command.some((part) => part.trim() === "")) {
    return Promise.resolve({ status: "unavailable", detail: "Configured command must contain non-empty arguments" });
  }
  return new Promise((resolve) => {
    const child = spawn(program, args, {
      cwd,
      stdio: "inherit",
      shell: false,
      detached: process.platform !== "win32",
    });
    let settled = false;
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    const onSignal = (signal: NodeJS.Signals): void => killTree(child, signal);
    const onExit = (): void => killTree(child, "SIGTERM");
    const onSigint = (): void => onSignal("SIGINT");
    const onSigterm = (): void => onSignal("SIGTERM");
    const cleanup = (): void => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
      process.removeListener("exit", onExit);
    };
    const finish = (result: ExecutionResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    process.once("exit", onExit);
    child.once("error", (error) => {
      finish({ status: "unavailable", detail: `Unable to spawn command: ${error.message}` });
    });
    child.once("close", (code, signal) => {
      // Keep listeners and the escalation timer alive until SIGKILL has had time
      // to reach descendants of a detached process group.
      if (timedOut) return;
      if (code === 0) {
        finish({ status: "passed", exitCode: 0 });
      } else {
        finish({
          status: "failed",
          exitCode: code ?? 1,
          ...(signal ? { detail: `Command terminated by ${signal}` } : {}),
        });
      }
    });
    timer = setTimeout(() => {
      timedOut = true;
      killTree(child, "SIGTERM");
      killTimer = setTimeout(() => {
        killTree(child, "SIGKILL");
        setTimeout(() => finish({ status: "timed-out", detail: `Command exceeded timeout of ${timeoutMs}ms` }), 250);
      }, 250);
    }, timeoutMs);
  });
}

function validContract(contract: NamedChecksConfig): void {
  if (!Array.isArray(contract.required) || contract.required.length === 0) throw new Error("Named checks require at least one required check");
  const seen = new Set<string>();
  for (const name of contract.required) {
    if (!CHECK_NAMES.includes(name) || seen.has(name)) throw new Error(`Invalid required check: ${name}`);
    seen.add(name);
  }
  for (const name of CHECK_NAMES) {
    const command = contract[name];
    if (command !== undefined && (!Array.isArray(command) || command.length === 0 || command.some((part) => typeof part !== "string" || part.trim() === ""))) {
      throw new Error(`Invalid ${name} command`);
    }
  }
  if (contract.timeoutMs !== undefined && (!Number.isInteger(contract.timeoutMs) || contract.timeoutMs < 1 || contract.timeoutMs > 3_600_000)) {
    throw new Error("Named check timeoutMs must be between 1 and 3600000");
  }
}

function resultFor(name: CheckName, command: string[] | undefined, result: Pick<NamedCheckResult, "status" | "exitCode" | "detail">): NamedCheckResult {
  return {
    name,
    status: result.status,
    ...(command ? { command: [...command] } : {}),
    ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
    ...(result.detail ? { detail: result.detail } : {}),
  };
}

async function runNamedChecks(cwd: string, issues: IntegrityIssue[], contract: NamedChecksConfig): Promise<CheckResult> {
  validContract(contract);
  const timeoutMs = contract.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const required = new Set(contract.required);
  const checks: NamedCheckResult[] = [];
  for (const name of CHECK_NAMES) {
    const command = contract[name];
    if (!required.has(name)) {
      checks.push(resultFor(name, command, { status: "skipped", detail: "Check is not required" }));
      continue;
    }
    if (!command) {
      checks.push(resultFor(name, undefined, { status: "unavailable", detail: "No command configured for required check" }));
      continue;
    }
    if (issues.length > 0) {
      checks.push(resultFor(name, command, { status: "skipped", detail: "Skipped because integrity checks failed" }));
      continue;
    }
    checks.push(resultFor(name, command, await execute(command, cwd, timeoutMs)));
  }
  const test = checks.find((check) => check.name === "test");
  const failed = checks.some((check) => check.status === "failed" || check.status === "timed-out" || check.status === "unavailable");
  return {
    issues,
    checks,
    testExitCode: failed ? (test?.exitCode && test.exitCode > 0 ? test.exitCode : 1) : (test?.exitCode ?? 0),
  };
}

export async function runChecks(cwd: string, integrityOnly = false, contract?: NamedChecksConfig): Promise<CheckResult> {
  const issues = await checkIntegrity(cwd);
  if (integrityOnly) return { issues };
  const config = await loadConfig(cwd);
  const named = contract ?? config.commands;
  if (named) return runNamedChecks(cwd, issues, named);
  if (issues.length > 0) return { issues };
  const result = await execute(config.testCommand, cwd, DEFAULT_TIMEOUT_MS);
  return { issues, testExitCode: result.exitCode ?? 1 };
}
