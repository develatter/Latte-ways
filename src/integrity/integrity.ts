import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_PATH, INDEX_DIR, KNOWLEDGE_DIR, MANIFEST_PATH, STATE_PATH } from "../domain/constants.js";
import type { ManagedManifest, WorkState } from "../domain/types.js";
import { validateConfig, validateManifest, validateState } from "../domain/validation.js";
import { sha256 } from "../fs/files.js";
import { indexesMatch } from "../knowledge/indexes.js";
import { inspectOkf } from "../knowledge/okf.js";
import { GitRepository } from "../git/git.js";

export interface IntegrityIssue {
  code: string;
  path: string;
  message: string;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile();
  } catch {
    return false;
  }
}

export async function checkIntegrity(cwd: string): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];
  const configPath = join(cwd, CONFIG_PATH);
  const manifestPath = join(cwd, MANIFEST_PATH);

  let manifest: ManagedManifest | undefined;
  try {
    const value = await readJson(manifestPath);
    if (validateManifest(value)) manifest = value;
    else issues.push({ code: "invalid-manifest", path: MANIFEST_PATH, message: "Manifest does not match its schema" });
  } catch {
    issues.push({ code: "missing-manifest", path: MANIFEST_PATH, message: "Managed manifest is missing or unreadable" });
  }

  try {
    if (!validateConfig(await readJson(configPath))) {
      issues.push({ code: "invalid-config", path: CONFIG_PATH, message: "Configuration does not match its schema" });
    }
  } catch {
    issues.push({ code: "missing-config", path: CONFIG_PATH, message: "Configuration is missing or unreadable" });
  }

  if (manifest) {
    for (const [relative, expected] of Object.entries(manifest.managedFiles)) {
      const path = join(cwd, relative);
      try {
        const actual = sha256(await readFile(path));
        if (actual !== expected) issues.push({ code: "managed-file-modified", path: relative, message: "Managed file hash differs from the manifest" });
      } catch {
        issues.push({ code: "managed-file-missing", path: relative, message: "Managed file is missing" });
      }
    }
  }

  try {
    const target = await readlink(join(cwd, "CLAUDE.md"));
    if (target !== "AGENTS.md") issues.push({ code: "invalid-symlink", path: "CLAUDE.md", message: "CLAUDE.md must target AGENTS.md" });
  } catch {
    issues.push({ code: "missing-symlink", path: "CLAUDE.md", message: "CLAUDE.md symlink is missing" });
  }

  let activeState: WorkState | undefined;
  if (await isFile(join(cwd, STATE_PATH))) {
    try {
      const value = await readJson(join(cwd, STATE_PATH));
      if (validateState(value)) activeState = value;
      else issues.push({ code: "invalid-state", path: STATE_PATH, message: "Active state does not match its schema" });
    } catch {
      issues.push({ code: "invalid-state", path: STATE_PATH, message: "Active state is unreadable" });
    }
  }

  if (activeState) {
    try {
      const git = new GitRepository(cwd);
      const head = await git.head();
      if (activeState.mode === "sdd" && activeState.lastCompletedPhase) {
        const certification = await git.findCertification(activeState.id, activeState.lastCompletedPhase);
        if (!certification || !await git.isAncestor(certification.hash, head) || await git.parent(certification.hash) !== activeState.gateCommit) {
          issues.push({ code: "state-git-divergence", path: STATE_PATH, message: "SDD state does not match certified Git history" });
        }
      } else if (activeState.mode === "sdd" || activeState.mode === "quick") {
        if (head !== activeState.baseCommit) issues.push({ code: "state-git-divergence", path: STATE_PATH, message: "Work HEAD changed outside a gate" });
      } else if (activeState.mode === "plan" && head !== activeState.baseCommit) {
        const commit = await git.lastCommit();
        if (commit.trailers.work !== activeState.id || commit.trailers.state !== "proposed") {
          issues.push({ code: "state-git-divergence", path: STATE_PATH, message: "Plan HEAD is not its proposal commit" });
        }
      }
    } catch {
      issues.push({ code: "state-git-divergence", path: STATE_PATH, message: "Unable to reconcile state with Git" });
    }
  }

  const okf = await inspectOkf(cwd);
  for (const issue of okf.issues) {
    const path = issue.path === KNOWLEDGE_DIR ? KNOWLEDGE_DIR : `${KNOWLEDGE_DIR}/${issue.path}`;
    issues.push({ code: issue.code, path, message: issue.message });
  }
  if (okf.issues.length === 0 && !await indexesMatch(cwd)) {
    issues.push({ code: "stale-index", path: INDEX_DIR, message: "Knowledge indexes do not match the OKF bundle" });
  }

  for (const role of ["explorer", "implementer", "reviewer", "orchestrator"]) {
    const relative = `.ways/agents/${role}.md`;
    try {
      const lines = (await readFile(join(cwd, relative), "utf8")).split("\n").filter((line) => line.trim().length > 0);
      if (lines.length > 6) issues.push({ code: "prompt-too-long", path: relative, message: "Agent prompt exceeds six non-empty lines" });
    } catch {
      // Managed-file checks report the missing file.
    }
  }

  return issues;
}
