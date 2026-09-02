import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SDD_DIR } from "../domain/constants.js";
import type { ReviewResult, WorkState } from "../domain/types.js";
import { validateReview, validationDetails } from "../domain/validation.js";
import { stableJson, writeAtomic } from "../fs/files.js";
import { loadState } from "../state/store.js";
import { workDigest } from "./digest.js";

export function reviewBlocks(result: ReviewResult): string[] {
  const blockers: string[] = [];
  for (const finding of result.findings) {
    if ((finding.severity === "critical" || finding.severity === "high") && finding.disposition !== "fixed") blockers.push(finding.id);
    if ((finding.severity === "medium" || finding.severity === "low") && finding.disposition === "open") blockers.push(finding.id);
  }
  if (result.verdict !== "pass") blockers.push("verdict");
  return [...new Set(blockers)];
}

export async function submitReview(cwd: string, inputPath: string): Promise<ReviewResult> {
  const state = await loadState(cwd);
  if (!state || state.mode !== "sdd" || state.phase !== "review") throw new Error("Reviews are accepted only during the review phase");
  const value: unknown = JSON.parse(await readFile(inputPath, "utf8"));
  if (!validateReview(value)) throw new Error(`Invalid review: ${validationDetails("review", value).errors.join("; ")}`);
  if (value.workId !== state.id) throw new Error("Review work id does not match active work");
  if (!value.reviewer.trim()) throw new Error("Independent reviewer identity is required");
  const digest = await workDigest(cwd, state.gateCommit);
  if (value.digest !== digest) throw new Error(`Review digest ${value.digest.slice(0, 12)} does not match the current diff ${digest.slice(0, 12)}; review the current content and obtain it with \`ways review digest\``);
  const target = join(cwd, SDD_DIR, state.id, "reviews", "latest.json");
  await writeAtomic(target, stableJson(value));
  return value;
}

/** Digest of the diff a reviewer must have looked at: everything since the last certified gate. */
export async function reviewDigest(cwd: string): Promise<string> {
  const state = await loadState(cwd);
  if (!state || state.mode !== "sdd" || state.phase !== "review") throw new Error("Review digests exist only during the review phase");
  return workDigest(cwd, state.gateCommit);
}

export async function assertReviewPassed(cwd: string, state: WorkState): Promise<void> {
  const path = join(cwd, SDD_DIR, state.id, "reviews", "latest.json");
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error("A delegated review result is required");
  }
  if (!validateReview(value)) throw new Error("Latest review is invalid");
  const blockers = reviewBlocks(value);
  if (blockers.length > 0) throw new Error(`Review gate blocked by: ${blockers.join(", ")}`);
  if (value.digest !== await workDigest(cwd, state.gateCommit)) throw new Error("Review is stale: content changed after it was submitted; obtain a fresh review");
}
