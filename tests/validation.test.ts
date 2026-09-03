import { describe, expect, it } from "vitest";
import { validateApproval, validateRemediation, validateReview, validateState, validationDetails } from "../src/domain/validation.js";

const state = {
  schemaVersion: 1,
  harnessVersion: "0.1.0",
  id: "auth-refresh",
  mode: "sdd",
  status: "active",
  profile: "autonomous",
  phase: "intake",
  baseCommit: "abcdef0",
  gateCommit: "abcdef0",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  tasks: [],
};

describe("contracts", () => {
  it("accepts a valid state", () => {
    expect(validateState(state)).toBe(true);
  });

  it("rejects unknown state fields", () => {
    expect(validateState({ ...state, surprise: true })).toBe(false);
  });

  it("reports useful schema errors", () => {
    const result = validationDetails("state", { ...state, mode: "query" });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("allowed values");
  });

  it("accepts legacy review and approval records with an omitted attempt", () => {
    const legacyReview = {
      schemaVersion: 1,
      workId: "auth-refresh",
      reviewer: "agent:reviewer",
      digest: "0".repeat(64),
      verdict: "pass",
      findings: [],
    } as const;
    const legacyApproval = {
      schemaVersion: 1,
      workId: "auth-refresh",
      phase: "plan",
      gateCommit: "0".repeat(40),
      digest: "0".repeat(64),
      approvedBy: "human",
      approvedAt: "2026-01-01T00:00:00Z",
    } as const;

    expect(validateReview(legacyReview)).toBe(true);
    expect(validateReview({ ...legacyReview, attempt: 1 })).toBe(true);
    expect(validateApproval(legacyApproval)).toBe(true);
    expect(validateApproval({ ...legacyApproval, attempt: 1 })).toBe(true);
    expect(validateReview({ ...legacyReview, attempt: -1 })).toBe(false);
    expect(validateReview({ ...legacyReview, attempt: 1.5 })).toBe(false);
    expect(validateReview({ ...legacyReview, attempt: Number.NaN })).toBe(false);
    expect(validateApproval({ ...legacyApproval, attempt: Number.MAX_SAFE_INTEGER + 1 })).toBe(false);
    expect(validateApproval({ ...legacyApproval, attempt: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it("validates source-bound remediation and state attempt metadata", () => {
    const review = {
      schemaVersion: 1,
      workId: "auth-refresh",
      reviewer: "agent:reviewer",
      digest: "0".repeat(64),
      verdict: "fail",
      findings: [],
    } as const;
    const remediation = {
      schemaVersion: 1,
      workId: "auth-refresh",
      source: "review",
      target: "implement",
      reason: "Correct the failed review finding",
      evidence: { kind: "review", review },
      priorCheckpoint: "a".repeat(40),
      attempt: 1,
      timestamp: "2024-02-29T23:59:59.123+05:30",
    } as const;
    const remediationState = {
      ...state,
      attempt: 1,
      remediation: {
        source: remediation.source,
        target: remediation.target,
        reason: remediation.reason,
        evidence: remediation.evidence,
        priorCheckpoint: remediation.priorCheckpoint,
        attempt: remediation.attempt,
        timestamp: remediation.timestamp,
      },
    };

    expect(validateRemediation(remediation)).toBe(true);
    for (const timestamp of [
      "2024-02-29T23:59:59Z",
      "2024-02-29T23:59:59.123Z",
      "2024-02-29T23:59:59+05:30",
      "2024-02-29T23:59:59-05:30",
    ]) expect(validateRemediation({ ...remediation, timestamp })).toBe(true);
    for (const timestamp of [
      "2024-02-29t23:59:59Z",
      "2024-02-29T23:59:59z",
      "2024-02-29T23:59:60Z",
      "2023-02-29T23:59:59Z",
    ]) expect(validateRemediation({ ...remediation, timestamp })).toBe(false);
    expect(validateRemediation({ ...remediation, source: "validate" })).toBe(false);
    expect(validateRemediation({ ...remediation, evidence: { kind: "review", review: { ...review, verdict: "pass" } } })).toBe(false);
    expect(validateRemediation({ ...remediation, timestamp: "2026-99-99T99:99:99Z" })).toBe(false);
    expect(validateRemediation({ ...remediation, timestamp: "2023-02-29T23:59:59.123+05:30" })).toBe(false);
    expect(validateRemediation({ ...remediation, timestamp: "2026-04-31T23:59:59.123+05:30" })).toBe(false);
    expect(validateRemediation({ ...remediation, attempt: Number.MAX_SAFE_INTEGER + 1 })).toBe(false);
    expect(validateRemediation({ ...remediation, attempt: Number.NaN })).toBe(false);
    expect(validateRemediation({ ...remediation, unexpected: true })).toBe(false);
    const { attempt: _attempt, ...stateWithoutAttempt } = remediationState;

    expect(validateState(remediationState)).toBe(true);
    expect(validateState(stateWithoutAttempt)).toBe(false);
    expect(validateState({ ...remediationState, attempt: 2 })).toBe(false);
    expect(validateState({ ...remediationState, attempt: 1.5 })).toBe(false);
    expect(validateState({ ...remediationState, attempt: Number.POSITIVE_INFINITY })).toBe(false);
    expect(validateState({ ...remediationState, remediation: { ...remediationState.remediation, attempt: 0 } })).toBe(false);
    expect(validateState({ ...remediationState, remediation: { ...remediationState.remediation, unexpected: true } })).toBe(false);
    expect(validateRemediation({
      ...remediation,
      source: "validate",
      evidence: { kind: "validate", failures: [{ check: "scripts/check.sh", detail: "test exited 1" }] },
    })).toBe(true);
  });
});
