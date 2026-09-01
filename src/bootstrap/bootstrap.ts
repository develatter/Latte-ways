import { chmod, lstat, mkdir, readFile, symlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HARNESS_VERSION } from "../index.js";
import { CONFIG_PATH, INDEX_DIR, KNOWLEDGE_DIR, MANIFEST_PATH, PLAN_DIR, SDD_DIR, STATE_PATH, WAYS_DIR } from "../domain/constants.js";
import type { HarnessConfig, ManagedManifest } from "../domain/types.js";
import { sha256, stableJson, writeAtomic } from "../fs/files.js";
import { GitRepository } from "../git/git.js";

export interface BootstrapOptions {
  cwd: string;
  testCommand: string[];
  force?: boolean;
}

const STATIC_FILES: Array<[string, string, number?]> = [
  ["AGENTS.md", "AGENTS.md"],
  ["MAP.md", "MAP.md"],
  ["scripts/check.sh", "check.sh", 0o755],
  [".ways/agents/explorer.md", "agents/explorer.md"],
  [".ways/agents/implementer.md", "agents/implementer.md"],
  [".ways/agents/reviewer.md", "agents/reviewer.md"],
  [".ways/agents/orchestrator.md", "agents/orchestrator.md"],
  [".ways/.gitignore", "ways.gitignore"],
];
const KNOWLEDGE_TYPES = ["system", "components", "conventions", "decisions", "faq"];

function assetPath(relative: string): string {
  return fileURLToPath(new URL(`../../assets/bootstrap/${relative}`, import.meta.url));
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function installFile(root: string, target: string, asset: string, force: boolean, mode?: number): Promise<string> {
  const targetPath = join(root, target);
  if (!force && await exists(targetPath)) throw new Error(`Refusing to overwrite ${target}; use --force`);
  const content = await readFile(assetPath(asset));
  await writeAtomic(targetPath, content.toString("utf8"), mode);
  if (mode !== undefined) await chmod(targetPath, mode);
  return sha256(content);
}

export async function bootstrap(options: BootstrapOptions): Promise<ManagedManifest> {
  const root = resolve(options.cwd);
  const git = new GitRepository(root);
  if (resolve(await git.root()) !== root) throw new Error("Bootstrap must run at the Git repository root");
  if (options.testCommand.length === 0) throw new Error("A test command is required");
  const force = options.force ?? false;

  await Promise.all([
    mkdir(join(root, dirname(STATE_PATH)), { recursive: true }),
    mkdir(join(root, PLAN_DIR), { recursive: true }),
    mkdir(join(root, SDD_DIR), { recursive: true }),
    mkdir(join(root, INDEX_DIR), { recursive: true }),
    mkdir(join(root, KNOWLEDGE_DIR), { recursive: true }),
  ]);

  const managedFiles: Record<string, string> = {};
  for (const [target, asset, mode] of STATIC_FILES) {
    managedFiles[target] = await installFile(root, target, asset, force, mode);
  }

  const claudePath = join(root, "CLAUDE.md");
  if (await exists(claudePath)) {
    if (!force) throw new Error("Refusing to replace CLAUDE.md; use --force");
    const { rm } = await import("node:fs/promises");
    await rm(claudePath, { force: true });
  }
  await symlink("AGENTS.md", claudePath);

  await installFile(root, `${KNOWLEDGE_DIR}/index.md`, "knowledge-index.md", force);
  for (const type of KNOWLEDGE_TYPES) {
    await installFile(root, `${KNOWLEDGE_DIR}/${type}/index.md`, "knowledge-directory-index.md", force);
  }

  const config: HarnessConfig = {
    schemaVersion: 1,
    harnessVersion: HARNESS_VERSION,
    testCommand: [...options.testCommand],
  };
  await writeAtomic(join(root, CONFIG_PATH), stableJson(config));

  const manifest: ManagedManifest = {
    schemaVersion: 1,
    harnessVersion: HARNESS_VERSION,
    generatedAt: new Date().toISOString(),
    managedFiles,
  };
  await writeAtomic(join(root, MANIFEST_PATH), stableJson(manifest));
  await writeAtomic(join(root, `${INDEX_DIR}/catalog.json`), stableJson({ schemaVersion: 1, documents: [] }));
  await writeAtomic(join(root, `${INDEX_DIR}/graph.json`), stableJson({ schemaVersion: 1, edges: [] }));
  await writeAtomic(join(root, `${INDEX_DIR}/search.json`), stableJson({ schemaVersion: 1, terms: {} }));

  return manifest;
}

export const BOOTSTRAP_PATHS = { CONFIG_PATH, MANIFEST_PATH, STATE_PATH, WAYS_DIR };
