import { chmod, readFile } from "node:fs/promises";
import { join } from "node:path";
import { assetPath, MANAGED_ASSETS } from "../bootstrap/bootstrap.js";
import { loadConfig } from "../config/config.js";
import { MANIFEST_PATH } from "../domain/constants.js";
import type { ManagedManifest } from "../domain/types.js";
import { HARNESS_VERSION } from "../index.js";
import { sha256, stableJson, writeAtomic } from "../fs/files.js";
import { validateManifest } from "../domain/validation.js";
import { runMigrations } from "./migrations.js";

export interface UpgradePlan {
  from: string;
  to: string;
  modifiedManagedFiles: string[];
}

async function manifest(cwd: string): Promise<ManagedManifest> {
  const value: unknown = JSON.parse(await readFile(join(cwd, MANIFEST_PATH), "utf8"));
  if (!validateManifest(value)) throw new Error("Installed manifest is invalid");
  return value;
}

export async function planUpgrade(cwd: string): Promise<UpgradePlan> {
  const installed = await manifest(cwd);
  const modified: string[] = [];
  for (const [path, expected] of Object.entries(installed.managedFiles)) {
    try {
      if (sha256(await readFile(join(cwd, path))) !== expected) modified.push(path);
    } catch {
      modified.push(path);
    }
  }
  return { from: installed.harnessVersion, to: HARNESS_VERSION, modifiedManagedFiles: modified.sort() };
}

export async function applyUpgrade(cwd: string, overwrite: Set<string>): Promise<UpgradePlan> {
  const plan = await planUpgrade(cwd);
  const refused = plan.modifiedManagedFiles.filter((path) => !overwrite.has(path) && !overwrite.has("*"));
  if (refused.length > 0) throw new Error(`Modified managed files require overwrite approval:\n${refused.map((path) => `- [ ] ${path}`).join("\n")}`);

  const config = await loadConfig(cwd);
  if (config.harnessVersion !== HARNESS_VERSION) await runMigrations({ cwd, config }, HARNESS_VERSION);
  config.harnessVersion = HARNESS_VERSION;
  await writeAtomic(join(cwd, ".ways/config.json"), stableJson(config));

  const managedFiles: Record<string, string> = {};
  for (const [target, asset, mode] of MANAGED_ASSETS) {
    const content = await readFile(assetPath(asset));
    await writeAtomic(join(cwd, target), content.toString("utf8"), mode);
    if (mode !== undefined) await chmod(join(cwd, target), mode);
    managedFiles[target] = sha256(content);
  }
  const next: ManagedManifest = {
    schemaVersion: 1,
    harnessVersion: HARNESS_VERSION,
    generatedAt: new Date().toISOString(),
    managedFiles,
  };
  await writeAtomic(join(cwd, MANIFEST_PATH), stableJson(next));
  return plan;
}
