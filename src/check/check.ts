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
    const child = spawn(program, args, { cwd, stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

export async function runChecks(cwd: string, integrityOnly = false): Promise<CheckResult> {
  const issues = await checkIntegrity(cwd);
  if (issues.length > 0 || integrityOnly) return { issues };
  const config = await loadConfig(cwd);
  return { issues, testExitCode: await execute(config.testCommand, cwd) };
}
