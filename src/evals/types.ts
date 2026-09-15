export type HarnessLabel = "no-ways" | "checks-only";

export interface EvalFile {
  path: string;
  content: string;
}

export interface EvalCheck {
  id: string;
  command: string[];
  expectedExitCode: number;
  expectedStdout?: string;
  expectedStderr?: string;
}

export interface EvalResume {
  prompt: string;
  fakePatch?: EvalFile[];
}

export interface EvalTask {
  id: string;
  description: string;
  setup: EvalFile[];
  prompt: string;
  success: EvalCheck[];
  regressions: EvalCheck[];
  fakePatch?: EvalFile[];
  freshSessionResume?: EvalResume;
}

export interface EvalCorpus {
  schemaVersion: 1;
  id: string;
  revision: string;
  tasks: EvalTask[];
}

export interface EvalBudgets {
  maxMilliseconds: number;
  maxOutputBytes: number;
}

export interface EvalConfiguration {
  adapter: { id: string; argv: string[] };
  harness: HarnessLabel;
  model: string;
  startingRevision: string;
  budgets: EvalBudgets;
  seed: number;
}

export interface AdapterInput {
  task: EvalTask;
  repo: string;
  prompt: string;
  session: "initial" | "resume";
  harness: HarnessLabel;
  model: string;
  startingRevision: string;
  seed: number;
  maxOutputBytes: number;
  signal: AbortSignal;
}

export interface UsageMetrics {
  available: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  reason?: string;
}

export interface AdapterExecution {
  doneClaim: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  overflow: boolean;
  error?: string;
  usage?: UsageMetrics;
}

export interface EvalCriterionResult {
  id: string;
  passed: boolean;
  expected: EvalCheck;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface GradedResult {
  success: boolean;
  regressions: boolean;
  successCriteria: EvalCriterionResult[];
  regressionCriteria: EvalCriterionResult[];
}
export interface EvalSessionResult {
  session: "initial" | "resume";
  doneClaim: boolean;
  elapsedMs: number;
  usage: UsageMetrics;
  adapter: { exitCode: number | null; timedOut: boolean; overflow: boolean; error: string | null };
  grading: GradedResult;
}

export interface EvalTaskResult {
  taskId: string;
  startingRevision: string;
  freshSessionResume: boolean;
  success: boolean;
  regressions: boolean;
  incorrectDoneClaim: boolean;
  elapsedMs: number;
  usage: UsageMetrics;
  sessions: EvalSessionResult[];
}

export interface EvalRunResult {
  schemaVersion: 1;
  runId: string;
  corpus: { id: string; revision: string; taskCount: number };
  configuration: EvalConfiguration;
  startedAt: string;
  finishedAt: string;
  evidence: { architecturalBenchmark: false; warning: string };
  tasks: EvalTaskResult[];
  summary: {
    taskCount: number;
    successCount: number;
    regressionCount: number;
    incorrectDoneClaimCount: number;
    elapsedMs: number;
  };
}

export interface EvalRunOptions {
  corpus?: EvalCorpus;
  corpusPath?: string;
  configuration: EvalConfiguration;
  adapter?: EvalAdapter;
  now?: () => Date;
}

export interface EvalAdapter {
  id: string;
  argv: string[];
  run(input: AdapterInput): Promise<AdapterExecution>;
}
