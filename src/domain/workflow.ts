import type { RemediationSource, RemediationTarget, SddPhase, WorkState } from "./types.js";

export const LEGACY_SDD_WORKFLOW_VERSION = 1 as const;
export type SddWorkflowVersion = typeof LEGACY_SDD_WORKFLOW_VERSION;

export interface SddWorkflowContract {
  readonly version: SddWorkflowVersion;
  readonly phases: readonly SddPhase[];
  readonly initialPhase: SddPhase;
  isPhase(value: string | undefined): value is SddPhase;
  nextPhase(phase: SddPhase): SddPhase | undefined;
  isHumanGate(phase: SddPhase): boolean;
  canRemediate(source: string | undefined, target: string | undefined): source is RemediationSource;
}

const phases = Object.freeze([
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
] as const satisfies readonly SddPhase[]);
const phaseIndexes: Record<SddPhase, number> = Object.fromEntries(phases.map((phase, index) => [phase, index])) as Record<SddPhase, number>;
const humanGates: Partial<Record<SddPhase, true>> = { intake: true, plan: true, close: true };
const remediationSources: Record<RemediationSource, true> = { review: true, validate: true };
const remediationTargets: Record<RemediationTarget, true> = { implement: true, decompose: true, plan: true, specify: true };

export const LEGACY_SDD_WORKFLOW: SddWorkflowContract = Object.freeze({
  version: LEGACY_SDD_WORKFLOW_VERSION,
  phases,
  initialPhase: phases[0],
  isPhase(value: string | undefined): value is SddPhase {
    return value !== undefined && Object.hasOwn(phaseIndexes, value);
  },
  nextPhase(phase: SddPhase): SddPhase | undefined {
    if (!Object.hasOwn(phaseIndexes, phase)) throw new Error(`Phase ${phase} is not part of SDD workflow version ${LEGACY_SDD_WORKFLOW_VERSION}`);
    return phases[phaseIndexes[phase] + 1];
  },
  isHumanGate(phase: SddPhase): boolean {
    return humanGates[phase] === true;
  },
  canRemediate(source: string | undefined, target: string | undefined): source is RemediationSource {
    return source !== undefined && target !== undefined
      && remediationSources[source as RemediationSource] === true
      && remediationTargets[target as RemediationTarget] === true;
  },
});

/** Missing versions are legacy SDD v1; explicit unsupported versions fail closed. */
export function sddWorkflow(version?: number): SddWorkflowContract {
  const resolved = version ?? LEGACY_SDD_WORKFLOW_VERSION;
  if (resolved !== LEGACY_SDD_WORKFLOW_VERSION) {
    throw new Error(`Unsupported SDD workflow version ${resolved}; supported versions: ${LEGACY_SDD_WORKFLOW_VERSION}`);
  }
  return LEGACY_SDD_WORKFLOW;
}

export function workflowForState(state: Pick<WorkState, "mode" | "workflowVersion">): SddWorkflowContract {
  if (state.mode !== "sdd") throw new Error(`Active ${state.mode} work does not have an SDD workflow contract`);
  return sddWorkflow(state.workflowVersion);
}

export function assertWorkflowState(state: Pick<WorkState, "mode" | "workflowVersion">): void {
  if (state.mode === "sdd") {
    workflowForState(state);
  } else if (state.workflowVersion !== undefined) {
    throw new Error(`Workflow version ${state.workflowVersion} is invalid for ${state.mode} work`);
  }
}
