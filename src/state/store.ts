import { rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { STATE_PATH } from "../domain/constants.js";
import type { WorkState } from "../domain/types.js";
import { validateState, validationDetails } from "../domain/validation.js";
import { stableJson, writeAtomic } from "../fs/files.js";
import { writeStatus } from "./status.js";

export async function loadState(cwd: string): Promise<WorkState | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(join(cwd, STATE_PATH), "utf8"));
    if (!validateState(value)) {
      throw new Error(`Invalid state: ${validationDetails("state", value).errors.join("; ")}`);
    }
    return value;
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    if (failure.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function saveState(cwd: string, state: WorkState): Promise<void> {
  if (!validateState(state)) throw new Error(`Refusing invalid state: ${validationDetails("state", state).errors.join("; ")}`);
  await writeAtomic(join(cwd, STATE_PATH), stableJson(state));
  await writeStatus(cwd, state);
}

export async function removeState(cwd: string): Promise<void> {
  await rm(join(cwd, STATE_PATH), { force: true });
  await writeStatus(cwd, undefined);
}
