import { join } from "node:path";
import { runChecks } from "../check/check.js";
import { loadConfig } from "../config/config.js";
import type { ValidationFailureRecord, WorkState } from "../domain/types.js";
import { validateConfig, validateValidationFailure } from "../domain/validation.js";
import { sha256, stableJson, writeAtomic } from "../fs/files.js";
import { GitRepository } from "../git/git.js";
import { attemptNumber, validationFailureRecordPath } from "./attempt.js";

function canonicalChecks(result: Awaited<ReturnType<typeof runChecks>>): ValidationFailureRecord["checks"] {
  return {
    integrity: [...result.issues]
      .sort((left, right) => left.code.localeCompare(right.code) || left.path.localeCompare(right.path) || left.message.localeCompare(right.message))
      .map(({ code, path, message }) => ({ code, path, message })),
    ...(result.testExitCode === undefined ? {} : { testExitCode: result.testExitCode }),
  };
}

export function validationFailureDigest(record: Omit<ValidationFailureRecord, "digest">): string {
  return sha256(stableJson(record));
}

export function validationFailureRecordFailure(record: ValidationFailureRecord): string | undefined {
  if (!validateValidationFailure(record)) return "validation failure record is invalid";
  if (record.digest !== validationFailureDigest({ ...record, digest: undefined } as Omit<ValidationFailureRecord, "digest">)) {
    return "validation failure record digest does not match its exact check results";
  }
  return undefined;
}

async function committedFailureRecord(git: GitRepository, workId: string, attempt: number, commit: string): Promise<ValidationFailureRecord | undefined> {
  try {
    const value: unknown = JSON.parse(await git.run(["show", `${commit}:${validationFailureRecordPath(workId, attempt)}`]));
    return validateValidationFailure(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Verify that a failure record was committed as the direct child of the exact tree it validates. */
export async function committedValidationFailureFailure(
  git: GitRepository,
  workId: string,
  attempt: number,
  commit: string,
): Promise<string | undefined> {
  const record = await committedFailureRecord(git, workId, attempt, commit);
  if (!record || record.workId !== workId || record.attempt !== attempt || record.phase !== "validate") {
    return `validation failure record is missing or mismatched at ${validationFailureRecordPath(workId, attempt)}`;
  }
  const invalid = validationFailureRecordFailure(record);
  if (invalid) return invalid;
  let parent: string;
  try {
    parent = await git.parent(commit);
  } catch {
    return "validation failure record commit has no input parent";
  }
  if (record.inputCommit !== parent || record.inputTree !== await git.run(["rev-parse", `${parent}^{tree}`])) {
    return "validation failure record does not bind its committed input tree";
  }
  const info = await git.commitInfo(commit);
  const expectedAttempt = attempt === 0 ? undefined : String(attempt);
  if (info.trailers.work !== workId || info.trailers.phase !== "validate" || info.trailers.state !== "validation-failed" || info.trailers.attempt !== expectedAttempt) {
    return "validation failure record commit trailers do not identify its work, attempt, and phase";
  }
  const path = validationFailureRecordPath(workId, attempt);
  const added = (await git.run(["diff-tree", "--no-commit-id", "--name-only", "--diff-filter=A", "-r", commit, "--", path])).split("\n").includes(path);
  const changed = (await git.run(["diff-tree", "--no-commit-id", "--name-only", "-r", commit])).split("\n").filter(Boolean);
  if (!added || changed.length !== 1 || changed[0] !== path) return "validation failure record commit must add only its record";
  try {
    const config: unknown = JSON.parse(await git.run(["show", `${parent}:.ways/config.json`]));
    if (!validateConfig(config) || JSON.stringify(config.testCommand) !== JSON.stringify(record.testCommand)) {
      return "validation failure record test command does not match its input tree";
    }
  } catch {
    return "validation failure record input configuration is unreadable";
  }
  return undefined;
}

export async function currentValidationFailureRecord(git: GitRepository, state: WorkState): Promise<ValidationFailureRecord> {
  const attempt = attemptNumber(state.attempt);
  const head = await git.head();
  const failure = await committedValidationFailureFailure(git, state.id, attempt, head);
  if (failure) throw new Error(`A committed validation failure record is required for remediation: ${failure}`);
  const record = await committedFailureRecord(git, state.id, attempt, head);
  if (!record) throw new Error("A committed validation failure record is required for remediation");
  return record;
}

/** Run checks against a clean committed validate input and preserve failures for deterministic replay. */
export async function recordValidationFailure(cwd: string): Promise<ValidationFailureRecord | undefined> {
  const { loadState } = await import("../state/store.js");
  const state = await loadState(cwd);
  if (!state || state.mode !== "sdd" || state.phase !== "validate") throw new Error("Validation recording requires an active SDD validate phase");
  const { assertSddConsistency } = await import("./sdd.js");
  await assertSddConsistency(cwd, state);
  const git = new GitRepository(cwd);
  await git.assertClean();
  const inputCommit = await git.head();
  const path = validationFailureRecordPath(state.id, state.attempt);
  try {
    await git.run(["cat-file", "-e", `${inputCommit}:${path}`]);
    throw new Error("Validation failure is already recorded; remediate it before recording another failure");
  } catch (error) {
    if (error instanceof Error && error.message.includes("already recorded")) throw error;
  }
  const inputTree = await git.run(["rev-parse", `${inputCommit}^{tree}`]);
  const config = await loadConfig(cwd);
  const result = await runChecks(cwd);
  if (result.issues.length === 0 && result.testExitCode === 0) return undefined;
  await git.assertClean();
  const record: ValidationFailureRecord = {
    schemaVersion: 1,
    workId: state.id,
    attempt: attemptNumber(state.attempt),
    phase: "validate",
    inputCommit,
    inputTree,
    testCommand: [...config.testCommand],
    checks: canonicalChecks(result),
    digest: "",
  };
  record.digest = validationFailureDigest({ ...record, digest: undefined } as Omit<ValidationFailureRecord, "digest">);
  const failure = validationFailureRecordFailure(record);
  if (failure) throw new Error(`Refusing to write ${failure}`);
  await writeAtomic(join(cwd, path), stableJson(record));
  await git.commit([path], `sdd(validate): record failure for ${state.id}`, {
    work: state.id,
    phase: "validate",
    state: "validation-failed",
    ...(attemptNumber(state.attempt) > 0 ? { attempt: String(attemptNumber(state.attempt)) } : {}),
  });
  return record;
}
