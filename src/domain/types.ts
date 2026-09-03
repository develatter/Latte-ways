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
export type RemediationSource = "review" | "validate";
export type RemediationTarget = "implement" | "decompose" | "plan" | "specify";

export interface TaskState {
  id: string;
  title: string;
  /** Absent on v1 task records and therefore interpreted as attempt zero. */
  attempt?: number;
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
  /** Absent on v1 state files and therefore interpreted as attempt zero. */
  attempt?: number;
  remediation?: RemediationMetadata;
  tasks: TaskState[];
}

export interface HarnessConfig {
  schemaVersion: 1;
  harnessVersion: string;
  testCommand: string[];
  defaultBranch?: string;
  historySince?: string;
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
  /** Absent on v1 review records and therefore interpreted as attempt zero. */
  attempt?: number;
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
  /** Absent on v1 approval records and therefore interpreted as attempt zero. */
  attempt?: number;
}

export interface ReviewFailureEvidence {
  kind: "review";
  review: ReviewResult & { verdict: "fail" };
}

export interface ValidationCheckFailure {
  check: string;
  detail: string;
}

export interface ValidationFailureEvidence {
  kind: "validate";
  failures: ValidationCheckFailure[];
}

export type RemediationEvidence = ReviewFailureEvidence | ValidationFailureEvidence;

/** The attempt-scoped state needed to reopen an SDD work without erasing its prior gate. */
export interface RemediationMetadata {
  source: RemediationSource;
  target: RemediationTarget;
  reason: string;
  evidence: RemediationEvidence;
  priorCheckpoint: string;
  attempt: number;
  timestamp: string;
}

/** Immutable transition record written when a remediation attempt is opened. */
export interface RemediationRecord extends RemediationMetadata {
  schemaVersion: 1;
  workId: string;
}
