import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { sha256, stableJson } from "../fs/files.js";
import { GitRepository } from "../git/git.js";
import { fakeAdapter, unavailableUsage } from "./adapters.js";
import { loadCorpus } from "./corpus.js";
import { gradeTask } from "./grader.js";
import type { AdapterExecution, AdapterInput, EvalAdapter, EvalConfiguration, EvalRunOptions, EvalRunResult, EvalSessionResult, EvalTask, EvalTaskResult, UsageMetrics } from "./types.js";

interface DisposableRepository {
  path: string;
  revision: string;
}

function repositoryPath(repo: string, path: string): string {
  const target = resolve(repo, path);
  const relativePath = relative(repo, target);
  if (relativePath === ".." || relativePath.startsWith("../") || relativePath.includes("/../")) throw new Error(`Eval setup path escapes repository: ${path}`);
  return target;
}

async function createRepository(task: EvalTask): Promise<DisposableRepository> {
  const path = await mkdtemp(join(tmpdir(), "ways-eval-repo-"));
  try {
    for (const file of task.setup) {
      const target = repositoryPath(path, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content, "utf8");
    }
    if (task.setup.length === 0) await writeFile(join(path, ".eval-fixture"), "", "utf8");
    const git = new GitRepository(path);
    const gitEnv = { GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_NOGLOBAL: "1", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_GLOBAL: "/dev/null" };
    await git.run(["init", "-q", "-b", "main"], gitEnv, true);
    await git.run(["config", "user.name", "Ways Eval"], gitEnv, true);
    await git.run(["config", "user.email", "ways-eval@example.test"], gitEnv, true);
    await git.run(["add", "."], gitEnv, true);
    await git.run(["-c", "commit.gpgSign=false", "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", "eval fixture"], gitEnv, true);
    return { path, revision: await git.run(["rev-parse", "HEAD"], gitEnv, true) };
  } catch (error) {
    await rm(path, { recursive: true, force: true });
    throw error;
  }
}

async function invoke(adapter: EvalAdapter, input: AdapterInput, timeoutMs: number): Promise<{ execution: AdapterExecution; timedOut: boolean; error: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const execution = await adapter.run({ ...input, signal: controller.signal });
    return { execution, timedOut: controller.signal.aborted, error: null };
  } catch (error) {
    return { execution: { doneClaim: false, exitCode: null, stdout: "", stderr: "", overflow: false }, timedOut: controller.signal.aborted, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function aggregateUsage(sessions: readonly EvalSessionResult[]): UsageMetrics {
  const values = sessions.map((session) => session.usage);
  const sum = (field: "inputTokens" | "outputTokens" | "totalTokens" | "costUsd"): number | null => values.every((usage) => usage.available && usage[field] !== null) ? values.reduce((total, usage) => total + (usage[field] ?? 0), 0) : null;
  const available = values.every((usage) => usage.available);
  return { available, inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens"), totalTokens: sum("totalTokens"), costUsd: sum("costUsd"), ...(available ? {} : { reason: "one or more sessions did not provide usage metrics" }) };
}

async function runSession(repo: string, revision: string, task: EvalTask, adapter: EvalAdapter, config: EvalConfiguration, session: "initial" | "resume", prompt: string): Promise<EvalSessionResult> {
  const started = Date.now();
  const result = await invoke(adapter, {
    task,
    repo,
    prompt,
    session,
    harness: config.harness,
    model: config.model,
    startingRevision: revision,
    seed: config.seed,
    maxOutputBytes: config.budgets.maxOutputBytes,
    signal: new AbortController().signal,
  }, config.budgets.maxMilliseconds);
  const grading = await gradeTask(repo, task, config.budgets.maxMilliseconds, config.budgets.maxOutputBytes);
  return {
    session,
    doneClaim: result.execution.doneClaim,
    elapsedMs: Date.now() - started,
    usage: result.execution.usage ?? unavailableUsage,
    adapter: { exitCode: result.execution.exitCode, timedOut: result.timedOut, overflow: result.execution.overflow, error: result.error ?? result.execution.error ?? null },
    grading,
  };
}

async function runTask(task: EvalTask, adapter: EvalAdapter, config: EvalConfiguration): Promise<EvalTaskResult> {
  const started = Date.now();
  let disposable: DisposableRepository | undefined;
  try {
    disposable = await createRepository(task);
    const sessions = [await runSession(disposable.path, disposable.revision, task, adapter, config, "initial", task.prompt)];
    if (task.freshSessionResume) sessions.push(await runSession(disposable.path, disposable.revision, task, adapter, config, "resume", task.freshSessionResume.prompt));
    const final = sessions.at(-1);
    if (!final) throw new Error("Eval task produced no session");
    const incorrectDoneClaim = sessions.some((session) => session.doneClaim && !session.grading.success);
    return {
      taskId: task.id,
      startingRevision: disposable.revision,
      freshSessionResume: task.freshSessionResume !== undefined,
      success: final.grading.success && sessions.every((session) => session.adapter.error === null && session.adapter.exitCode === 0 && !session.adapter.timedOut && !session.adapter.overflow),
      regressions: sessions.some((session) => session.grading.regressions),
      incorrectDoneClaim,
      elapsedMs: Date.now() - started,
      usage: aggregateUsage(sessions),
      sessions,
    };
  } catch (error) {
    return {
      taskId: task.id,
      startingRevision: disposable?.revision ?? "unavailable",
      freshSessionResume: task.freshSessionResume !== undefined,
      success: false,
      regressions: false,
      incorrectDoneClaim: false,
      elapsedMs: Date.now() - started,
      usage: unavailableUsage,
      sessions: [{
        session: "initial",
        doneClaim: false,
        elapsedMs: Date.now() - started,
        usage: unavailableUsage,
        adapter: { exitCode: null, timedOut: false, overflow: false, error: error instanceof Error ? error.message : String(error) },
        grading: { success: false, regressions: false, successCriteria: [], regressionCriteria: [] },
      }],
    };
  } finally {
    if (disposable) await rm(disposable.path, { recursive: true, force: true });
  }
}

export async function runEvals(options: EvalRunOptions): Promise<EvalRunResult> {
  const corpus = options.corpus ?? await loadCorpus(options.corpusPath);
  const adapter = options.adapter ?? fakeAdapter;
  const configuration = options.configuration;
  if (configuration.adapter.id !== adapter.id || JSON.stringify(configuration.adapter.argv) !== JSON.stringify(adapter.argv)) throw new Error("Eval configuration adapter identity does not match the adapter being run");
  if (configuration.startingRevision !== corpus.revision) throw new Error("Eval configuration revision must match corpus revision");
  const now = options.now ?? (() => new Date());
  const startedDate = now();
  const runId = sha256(stableJson({ corpus: corpus.id, revision: corpus.revision, configuration, startedAt: startedDate.toISOString() })).slice(0, 16);
  const tasks = [];
  for (const task of corpus.tasks) tasks.push(await runTask(task, adapter, configuration));
  const finishedDate = now();
  return {
    schemaVersion: 1,
    runId,
    corpus: { id: corpus.id, revision: corpus.revision, taskCount: corpus.tasks.length },
    configuration,
    startedAt: startedDate.toISOString(),
    finishedAt: finishedDate.toISOString(),
    evidence: { architecturalBenchmark: false, warning: "Task outcomes only; synthetic adapter runs are not architectural evidence." },
    tasks,
    summary: {
      taskCount: tasks.length,
      successCount: tasks.filter((task) => task.success).length,
      regressionCount: tasks.filter((task) => task.regressions).length,
      incorrectDoneClaimCount: tasks.filter((task) => task.incorrectDoneClaim).length,
      elapsedMs: tasks.reduce((sum, task) => sum + task.elapsedMs, 0),
    },
  };
}
