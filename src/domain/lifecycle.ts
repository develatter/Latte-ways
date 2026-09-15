import { SDD_PHASES, type RemediationTarget, type SddPhase } from "./types.js";

/** Version of the persisted lifecycle semantics, independent of the CLI version. */
export const LIFECYCLE_CONTRACT_VERSION = 1 as const;

const REMEDIATION_TARGETS = ["implement", "decompose", "plan", "specify"] as const satisfies readonly RemediationTarget[];
const HUMAN_GATE_PHASES = ["intake", "plan", "close"] as const satisfies readonly SddPhase[];

type VersionedRecord = { schemaVersion: unknown };

type LifecycleErrorCode =
  | "lifecycle-unsupported-version"
  | "lifecycle-invalid-attempt"
  | "lifecycle-invalid-phase"
  | "lifecycle-inconsistent-transition";

export class LifecycleContractError extends Error {
  constructor(readonly code: LifecycleErrorCode, message: string) {
    super(message);
    this.name = "LifecycleContractError";
  }
}

export interface CertificationTransition {
  workId: string;
  completedPhase: unknown;
  expectedPhase: unknown;
  attempt: unknown;
  expectedAttempt: unknown;
  validationFailed?: boolean;
}

export interface RemediationTransition {
  workId: string;
  sourcePhase: unknown;
  currentPhase: unknown;
  target: unknown;
  attempt: unknown;
  expectedAttempt: unknown;
}

export interface LifecycleContract {
  readonly schemaVersion: typeof LIFECYCLE_CONTRACT_VERSION;
  readonly phases: typeof SDD_PHASES;
  readonly remediationTargets: typeof REMEDIATION_TARGETS;
  readonly humanGatePhases: typeof HUMAN_GATE_PHASES;
  readonly reviewPhase: "review";
  readonly validationPhase: "validate";
  readonly implementPhase: "implement";
  readonly decomposePhase: "decompose";
  readonly legacyAttemptOmittedMeansZero: true;
  isPhase(value: unknown, context?: string): value is SddPhase;
  nextPhase(value: unknown, context?: string): SddPhase | undefined;
  isRemediationTarget(value: unknown): value is RemediationTarget;
  attemptNumber(value: unknown, context?: string): number;
  attemptTrailerMatches(value: string | undefined, attempt: number): boolean;
  certificationFailure(input: CertificationTransition): string | undefined;
  remediationFailure(input: RemediationTransition): string | undefined;
}

function shown(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function resolvePhase(value: unknown, context: string): SddPhase {
  if (typeof value === "string" && SDD_PHASES.includes(value as SddPhase)) return value as SddPhase;
  throw new LifecycleContractError(
    "lifecycle-invalid-phase",
    `${context} is not a recognized SDD phase; refusing to infer lifecycle order from ${shown(value)}`,
  );
}

function resolveAttempt(value: unknown, context: string): number {
  const valid = value === undefined
    || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    || (typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value)));
  if (!valid) {
    throw new LifecycleContractError(
      "lifecycle-invalid-attempt",
      `Attempt (${context}) must be a non-negative safe integer; refusing to infer a lifecycle attempt from ${shown(value)}`,
    );
  }
  return value === undefined ? 0 : Number(value);
}

function evaluateCertificationFailure(input: CertificationTransition): string | undefined {
  const completed = resolvePhase(input.completedPhase, "completed phase");
  const expected = resolvePhase(input.expectedPhase, "expected phase");
  const attempt = resolveAttempt(input.attempt, `certification of ${input.workId}`);
  const expectedAttempt = resolveAttempt(input.expectedAttempt, `expected attempt for ${input.workId}`);
  if (input.validationFailed) {
    return `Certification of ${completed} for ${input.workId} bypasses a validation failure in attempt ${expectedAttempt}; remediation is required`;
  }
  if (attempt !== expectedAttempt || completed !== expected) {
    return `Certification of ${completed} for ${input.workId} is out of order for attempt ${expectedAttempt}; expected ${expected}`;
  }
  return undefined;
}

function evaluateRemediationFailure(input: RemediationTransition): string | undefined {
  const source = resolvePhase(input.sourcePhase, "remediation source phase");
  const current = resolvePhase(input.currentPhase, `current phase for ${input.workId}`);
  const attempt = resolveAttempt(input.attempt, `remediation of ${input.workId}`);
  const expectedAttempt = resolveAttempt(input.expectedAttempt, `expected remediation attempt for ${input.workId}`);
  const validTarget = typeof input.target === "string" && REMEDIATION_TARGETS.includes(input.target as RemediationTarget);
  if ((source !== "review" && source !== "validate") || source !== current || !validTarget || attempt !== expectedAttempt + 1) {
    return `Remediation transition for ${input.workId} is not a legal ${current} attempt ${expectedAttempt + 1} transition`;
  }
  return undefined;
}

const CONTRACT: LifecycleContract = Object.freeze({
  schemaVersion: LIFECYCLE_CONTRACT_VERSION,
  phases: SDD_PHASES,
  remediationTargets: REMEDIATION_TARGETS,
  humanGatePhases: HUMAN_GATE_PHASES,
  reviewPhase: "review",
  validationPhase: "validate",
  implementPhase: "implement",
  decomposePhase: "decompose",
  legacyAttemptOmittedMeansZero: true,
  isPhase(value: unknown, context = "phase"): value is SddPhase {
    try {
      resolvePhase(value, context);
      return true;
    } catch {
      return false;
    }
  },
  nextPhase(value: unknown, context = "phase"): SddPhase | undefined {
    const current = resolvePhase(value, context);
    return SDD_PHASES[SDD_PHASES.indexOf(current) + 1];
  },
  isRemediationTarget(value: unknown): value is RemediationTarget {
    return typeof value === "string" && REMEDIATION_TARGETS.includes(value as RemediationTarget);
  },
  attemptNumber(value: unknown, context = "attempt"): number {
    return resolveAttempt(value, context);
  },
  attemptTrailerMatches(value: string | undefined, attempt: number): boolean {
    try {
      return resolveAttempt(value, "history trailer") === attempt;
    } catch {
      return false;
    }
  },
  certificationFailure: evaluateCertificationFailure,
  remediationFailure: evaluateRemediationFailure,
});

/** Resolve a persisted contract before interpreting any lifecycle fields. */
export function lifecycleContract(value: unknown, context = "lifecycle record"): LifecycleContract {
  if (value === LIFECYCLE_CONTRACT_VERSION) return CONTRACT;
  throw new LifecycleContractError(
    "lifecycle-unsupported-version",
    `${context} uses unsupported lifecycle contract version ${shown(value)}; received version ${shown(value)}; supported versions: ${LIFECYCLE_CONTRACT_VERSION}`,
  );
}

/** Resolve the contract carried by a lifecycle record; omission is not a valid record version. */
export function recordVersion(value: unknown, context = "lifecycle record"): LifecycleContract {
  if (value === null || typeof value !== "object" || !("schemaVersion" in value)) return lifecycleContract(undefined, context);
  return lifecycleContract((value as VersionedRecord).schemaVersion, context);
}

export function assertLifecycleVersion(value: unknown, context = "lifecycle record"): asserts value is typeof LIFECYCLE_CONTRACT_VERSION {
  lifecycleContract(value, context);
}

export function attemptNumber(value: unknown, context = "attempt"): number {
  return CONTRACT.attemptNumber(value, context);
}

export function attemptTrailerMatches(value: string | undefined, attempt: number): boolean {
  return CONTRACT.attemptTrailerMatches(value, attempt);
}

export function isSddPhase(value: string | undefined): value is SddPhase {
  return CONTRACT.isPhase(value);
}

export function nextPhase(value: SddPhase): SddPhase | undefined {
  return CONTRACT.nextPhase(value);
}

export function certificationFailure(input: CertificationTransition): string | undefined {
  return CONTRACT.certificationFailure(input);
}

export function remediationFailure(input: RemediationTransition): string | undefined {
  return CONTRACT.remediationFailure(input);
}
