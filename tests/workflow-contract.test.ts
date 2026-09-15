import { describe, expect, it } from "vitest";
import {
  LEGACY_SDD_WORKFLOW,
  LEGACY_SDD_WORKFLOW_VERSION,
  assertWorkflowState,
  sddWorkflow,
} from "../src/domain/workflow.js";

describe("legacy SDD workflow contract", () => {
  it("preserves the complete v1 lifecycle and completion boundary", () => {
    expect(sddWorkflow()).toBe(LEGACY_SDD_WORKFLOW);
    expect(LEGACY_SDD_WORKFLOW.version).toBe(LEGACY_SDD_WORKFLOW_VERSION);
    expect(LEGACY_SDD_WORKFLOW.phases).toEqual([
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
    ]);
    expect(LEGACY_SDD_WORKFLOW.phases.map((phase) => LEGACY_SDD_WORKFLOW.nextPhase(phase))).toEqual([
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
      undefined,
    ]);
  });

  it("preserves supervised gates and additive remediation edges", () => {
    expect(LEGACY_SDD_WORKFLOW.phases.filter((phase) => LEGACY_SDD_WORKFLOW.isHumanGate(phase))).toEqual(["intake", "plan", "close"]);
    for (const source of ["review", "validate"] as const) {
      for (const target of ["implement", "decompose", "plan", "specify"] as const) {
        expect(LEGACY_SDD_WORKFLOW.canRemediate(source, target)).toBe(true);
      }
    }
    expect(LEGACY_SDD_WORKFLOW.canRemediate("implement", "review")).toBe(false);
    expect(LEGACY_SDD_WORKFLOW.canRemediate("review", "close")).toBe(false);
  });

  it("reads absent versions as v1 and rejects unknown or inconsistent records", () => {
    expect(sddWorkflow(undefined).version).toBe(1);
    expect(() => sddWorkflow(2)).toThrow(/Unsupported SDD workflow version 2; supported versions: 1/);
    expect(() => assertWorkflowState({ mode: "quick", workflowVersion: 1 })).toThrow(/invalid for quick work/);
    expect(() => LEGACY_SDD_WORKFLOW.nextPhase("unknown" as never)).toThrow(/not part of SDD workflow version 1/);
  });
});
