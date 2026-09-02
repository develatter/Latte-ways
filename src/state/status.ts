import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { STATUS_PATH } from "../domain/constants.js";
import type { ApprovalProfile, Mode, SddPhase, WorkState, WorkStatus } from "../domain/types.js";
import { stableJson, writeAtomic } from "../fs/files.js";

export const HUMAN_GATES: ReadonlySet<SddPhase> = new Set<SddPhase>(["intake", "plan", "close"]);

export interface StatusSummary {
  schemaVersion: 1;
  active: boolean;
  mode?: Exclude<Mode, "query">;
  id?: string;
  status?: WorkStatus;
  phase?: SddPhase;
  profile?: ApprovalProfile;
  humanGate?: boolean;
  gateCommit?: string;
  updatedAt: string;
}

export function projectStatus(state: WorkState | undefined, now = new Date().toISOString()): StatusSummary {
  if (!state) return { schemaVersion: 1, active: false, updatedAt: now };
  const summary: StatusSummary = {
    schemaVersion: 1,
    active: true,
    mode: state.mode,
    id: state.id,
    status: state.status,
    gateCommit: state.gateCommit,
    updatedAt: state.updatedAt,
  };
  if (state.phase) {
    summary.phase = state.phase;
    summary.humanGate = state.profile === "supervised" && HUMAN_GATES.has(state.phase);
  }
  if (state.profile) summary.profile = state.profile;
  return summary;
}

export async function writeStatus(cwd: string, state: WorkState | undefined): Promise<StatusSummary> {
  if (!state) {
    const existing = await readStatus(cwd);
    if (existing && existing.active === false) return existing;
  }
  const summary = projectStatus(state);
  await writeAtomic(join(cwd, STATUS_PATH), stableJson(summary));
  return summary;
}

export async function readStatus(cwd: string): Promise<StatusSummary | undefined> {
  try {
    return JSON.parse(await readFile(join(cwd, STATUS_PATH), "utf8")) as StatusSummary;
  } catch {
    return undefined;
  }
}

export function statusMatches(actual: StatusSummary | undefined, state: WorkState | undefined): boolean {
  if (!actual) return false;
  return stableJson(projectStatus(state, actual.updatedAt)) === stableJson(actual);
}
