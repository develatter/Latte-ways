export const MODES = ["query", "quick", "plan", "sdd"] as const;
export type Mode = (typeof MODES)[number];

export const SDD_PHASES = [
  "intake",
  "explore",
  "assess",
  "specify",
  "plan",
  "decompose",
  "implement",
  "review",
  "validate",
  "reconcile-memory",
  "close",
] as const;
export type SddPhase = (typeof SDD_PHASES)[number];

export type WorkStatus = "active" | "blocked" | "completed" | "cancelled";
export type ApprovalProfile = "autonomous" | "supervised";
export type ExecutionMode = "inline" | "delegated";
export type TaskStatus = "pending" | "ready" | "active" | "review" | "completed" | "blocked";
export type FindingSeverity = "critical" | "high" | "medium" | "low";
export type FindingDisposition = "open" | "fixed" | "accepted" | "deferred";

export interface TaskState {
  id: string;
  title: string;
  status: TaskStatus;
  dependsOn: string[];
  commits: string[];
  branch?: string;
  worktree?: string;
}

export interface WorkState {
  schemaVersion: 1;
  harnessVersion: string;
  id: string;
  mode: Exclude<Mode, "query">;
  status: WorkStatus;
  baseCommit: string;
  gateCommit: string;
  createdAt: string;
  updatedAt: string;
  profile?: ApprovalProfile;
  execution?: ExecutionMode;
  phase?: SddPhase;
  lastCompletedPhase?: SddPhase;
  planPath?: string;
  tasks: TaskState[];
}

export interface MemoryConfig {
  releaseBranch: string;
  integrationBranch?: string;
  reconciliationBranchPattern: string;
  relevantPaths: string[];
  excludedPaths: string[];
}

export interface HarnessConfig {
  schemaVersion: 1;
  harnessVersion: string;
  testCommand: string[];
  defaultBranch?: string;
  historySince?: string;
  memory?: MemoryConfig;
}

export interface ManagedManifest {
  schemaVersion: 1;
  harnessVersion: string;
  generatedAt: string;
  managedFiles: Record<string, string>;
  adapters?: Record<string, Record<string, string>>;
}

export interface ReviewFinding {
  id: string;
  severity: FindingSeverity;
  summary: string;
  disposition: FindingDisposition;
}

export interface ReviewResult {
  schemaVersion: 1;
  workId: string;
  reviewer: string;
  digest: string;
  verdict: "pass" | "fail";
  findings: ReviewFinding[];
  taskId?: string;
}

export interface ApprovalRecord {
  schemaVersion: 1;
  workId: string;
  phase: SddPhase;
  gateCommit: string;
  digest: string;
  approvedBy: string;
  approvedAt: string;
}
