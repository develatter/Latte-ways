import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { userInfo } from "node:os";
import { lifecycleContract, recordVersion, type LifecycleContract } from "../domain/lifecycle.js";
import { type ApprovalRecord, type SddPhase, type WorkState } from "../domain/types.js";
import { validationDetails } from "../domain/validation.js";
import { stableJson, writeAtomic } from "../fs/files.js";
import { GitRepository } from "../git/git.js";
import { loadState } from "../state/store.js";
import { attemptApprovalPath, attemptPhasePath } from "./attempt.js";
import { workDigest } from "./digest.js";

export function approvalPath(workId: string, phase: string, attempt?: number): string {
  const contract = lifecycleContract(1, "approval path");
  if (!contract.isPhase(phase)) throw new Error("Approval phase must be an SDD phase");
  return attemptApprovalPath(workId, attempt, phase as SddPhase);
}

export function requiresApproval(state: WorkState): boolean {
  const contract = recordVersion(state, "SDD state");
  return state.mode === "sdd" && state.profile === "supervised" && state.phase !== undefined
    && contract.humanGatePhases.some((phase) => phase === state.phase);
}

async function gateState(cwd: string): Promise<WorkState> {
  const state = await loadState(cwd);
  if (!state || state.mode !== "sdd" || !state.phase) throw new Error("No active SDD work");
  if (!requiresApproval(state)) throw new Error(`Phase ${state.phase} of ${state.id} does not require human approval`);
  return state;
}

async function writeApproval(cwd: string, approvedBy: string): Promise<ApprovalRecord> {
  const state = await gateState(cwd);
  const contract = recordVersion(state, "SDD state");
  if (!approvedBy.trim()) throw new Error("Approver identity is required");
  const attempt = contract.attemptNumber(state.attempt);
  const record: ApprovalRecord = {
    schemaVersion: contract.schemaVersion,
    workId: state.id,
    phase: state.phase!,
    gateCommit: state.gateCommit,
    digest: await workDigest(cwd, state.gateCommit),
    approvedBy: approvedBy.trim(),
    approvedAt: new Date().toISOString(),
    ...(attempt === 0 ? {} : { attempt }),
  };
  await writeAtomic(join(cwd, approvalPath(record.workId, record.phase, record.attempt)), stableJson(record));
  return record;
}

export interface Terminal {
  interactive: boolean;
  ask(question: string): Promise<string>;
  say(line: string): void;
}

export function processTerminal(): Terminal {
  return {
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    async ask(question) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
    say(line) {
      console.log(line);
    },
  };
}

async function approverIdentity(cwd: string): Promise<string> {
  const git = new GitRepository(cwd);
  try {
    const name = await git.run(["config", "user.name"]);
    const email = await git.run(["config", "user.email"]);
    if (name && email) return `${name} <${email}>`;
    if (name) return name;
  } catch {
    // Fall back to the OS user.
  }
  return userInfo().username;
}

/**
 * Human-gate approval. Refuses without a real terminal on both ends so an agent
 * driving the CLI through a tool cannot approve on the human's behalf, and asks
 * the human to type the phase name after seeing what they are approving.
 */
export async function approveInteractively(cwd: string, terminal: Terminal = processTerminal()): Promise<ApprovalRecord> {
  if (!terminal.interactive) throw new Error("Approval requires an interactive terminal; the human must run `ways approve` themselves");
  const state = await gateState(cwd);
  const digest = await workDigest(cwd, state.gateCommit);
  terminal.say(`Work ${state.id}, phase ${state.phase}, gate ${state.gateCommit.slice(0, 12)}, digest ${digest.slice(0, 12)}`);
  terminal.say(`Read ${attemptPhasePath(state.id, state.attempt, state.phase!)} and the diff since the gate before approving.`);
  const answer = await terminal.ask(`Type "${state.phase}" to approve: `);
  if (answer.trim() !== state.phase) throw new Error("Approval cancelled");
  return writeApproval(cwd, await approverIdentity(cwd));
}

export async function readApproval(cwd: string, workId: string, phase: string, attempt?: number): Promise<ApprovalRecord | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(join(cwd, approvalPath(workId, phase, attempt)), "utf8"));
    const details = validationDetails("approval", value);
    if (!details.valid && details.errors.some((error) => error.includes("unsupported lifecycle contract version"))) {
      throw new Error(`Invalid approval: ${details.errors.join("; ")}`);
    }
    return details.valid ? value as ApprovalRecord : undefined;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Invalid approval:")) throw error;
    return undefined;
  }
}
export function approvalBinds(
  record: ApprovalRecord,
  expected: { workId: string; phase: string; gateCommit: string; digest?: string; attempt?: number | undefined; contract?: LifecycleContract },
): string | undefined {
  try {
    const contract = expected.contract ?? recordVersion(record, "approval record");
    if (!contract.isPhase(record.phase) || record.workId !== expected.workId || record.phase !== expected.phase) {
      return "approval belongs to another work or phase";
    }
    if (contract.attemptNumber(record.attempt) !== contract.attemptNumber(expected.attempt)) return "approval belongs to another remediation attempt";
    if (record.gateCommit !== expected.gateCommit) return "approval was given at another gate commit";
    if (expected.digest !== undefined && record.digest !== expected.digest) return "content changed after approval";
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Throws unless a valid approval bound to the current gate and content exists. */
export async function assertApproved(cwd: string, state: WorkState): Promise<ApprovalRecord> {
  const contract = recordVersion(state, "SDD state");
  const phase = state.phase!;
  const record = await readApproval(cwd, state.id, phase, state.attempt);
  if (!record) throw new Error(`Phase ${phase} requires explicit human approval; the human runs \`ways approve\` in a terminal`);
  const failure = approvalBinds(record, {
    workId: state.id,
    phase,
    gateCommit: state.gateCommit,
    digest: await workDigest(cwd, state.gateCommit),
    attempt: state.attempt,
    contract,
  });
  if (failure) throw new Error(`Approval for ${phase} is not valid: ${failure}; the human must approve again`);
  return record;
}
