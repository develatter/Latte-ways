import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_PATH } from "../domain/constants.js";
import type { HarnessConfig, MemoryConfig } from "../domain/types.js";
import { validateConfig, validationDetails } from "../domain/validation.js";
import { normalizeGlob } from "../memory/glob.js";

export async function loadConfig(cwd: string): Promise<HarnessConfig> {
  const value: unknown = JSON.parse(await readFile(join(cwd, CONFIG_PATH), "utf8"));
  if (!validateConfig(value)) throw new Error(`Invalid config: ${validationDetails("config", value).errors.join("; ")}`);
  if (value.memory) assertMemoryConfig(value.memory);
  return value;
}

export function assertMemoryConfig(config: MemoryConfig): void {
  if (config.integrationBranch === config.releaseBranch) throw new Error("Memory integrationBranch must differ from releaseBranch");
  if ((config.reconciliationBranchPattern.match(/\*/g) ?? []).length !== 1) throw new Error("Memory reconciliationBranchPattern must contain exactly one wildcard");
  for (const pattern of [...config.relevantPaths, ...config.excludedPaths]) normalizeGlob(pattern);
}

export function effectiveMemoryConfig(config: HarnessConfig): MemoryConfig {
  const memory = config.memory ?? {
    releaseBranch: config.defaultBranch ?? "main",
    reconciliationBranchPattern: "reconcile/*",
    relevantPaths: ["**/*"],
    excludedPaths: [".git/**", ".ways/**", "dist/**", "node_modules/**"],
  };
  assertMemoryConfig(memory);
  return memory;
}
