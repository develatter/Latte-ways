import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_PATH } from "../domain/constants.js";
import type { HarnessConfig } from "../domain/types.js";
import { validateConfig, validationDetails } from "../domain/validation.js";

export async function loadConfig(cwd: string): Promise<HarnessConfig> {
  const value: unknown = JSON.parse(await readFile(join(cwd, CONFIG_PATH), "utf8"));
  if (!validateConfig(value)) throw new Error(`Invalid config: ${validationDetails("config", value).errors.join("; ")}`);
  return value;
}
