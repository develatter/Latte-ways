import { describe, expect, it } from "vitest";
import {
  attemptApprovalPath,
  attemptArtifactDirectory,
  attemptArtifactPath,
  attemptPhasePath,
  attemptReviewPath,
  isPriorAttemptArtifact,
  remediationRecordPath,
} from "../src/work/attempt.js";

describe("attempt-scoped SDD artifact paths", () => {
  it("uses the v1 layout for absent and zero attempts", () => {
    expect(attemptArtifactDirectory("auth-refresh", undefined)).toBe(".ways/sdd/auth-refresh");
    expect(attemptPhasePath("auth-refresh", 0, "implement")).toBe(".ways/sdd/auth-refresh/implement.md");
    expect(attemptReviewPath("auth-refresh", 0)).toBe(".ways/sdd/auth-refresh/reviews/latest.json");
    expect(attemptApprovalPath("auth-refresh", 0, "plan")).toBe(".ways/sdd/auth-refresh/approvals/plan.json");
  });

  it("isolates remediation artifacts by positive attempt", () => {
    expect(attemptPhasePath("auth-refresh", 2, "implement")).toBe(".ways/sdd/auth-refresh/attempts/2/implement.md");
    expect(attemptReviewPath("auth-refresh", 2)).toBe(".ways/sdd/auth-refresh/attempts/2/reviews/latest.json");
    expect(remediationRecordPath("auth-refresh", 2)).toBe(".ways/sdd/auth-refresh/attempts/2/remediation.json");
  });

  it("protects every prior attempt evidence category while allowing active phase work", () => {
    for (const path of [
      ".ways/sdd/auth-refresh/implement.md",
      ".ways/sdd/auth-refresh/reviews/latest.json",
      ".ways/sdd/auth-refresh/approvals/plan.json",
      ".ways/sdd/auth-refresh/attempts/1/remediation.json",
    ]) expect(isPriorAttemptArtifact(path, "auth-refresh", 2)).toBe(true);
    expect(isPriorAttemptArtifact(".ways/sdd/auth-refresh/attempts/2/implement.md", "auth-refresh", 2)).toBe(false);
  });

  it("rejects invalid work ids, attempts, and path segments", () => {
    expect(() => attemptArtifactDirectory("../escape", 1)).toThrow(/Work id/);
    expect(() => attemptArtifactDirectory("auth-refresh", -1)).toThrow(/Attempt/);
    expect(() => attemptArtifactDirectory("auth-refresh", 1.5)).toThrow(/Attempt/);
    expect(() => attemptArtifactDirectory("auth-refresh", Number.NaN)).toThrow(/Attempt/);
    expect(() => attemptArtifactDirectory("auth-refresh", Number.POSITIVE_INFINITY)).toThrow(/Attempt/);
    expect(() => attemptArtifactDirectory("auth-refresh", Number.MAX_SAFE_INTEGER + 1)).toThrow(/Attempt/);
    expect(() => attemptArtifactPath("auth-refresh", 1)).toThrow(/safe path segments/);
    expect(() => attemptArtifactPath("auth-refresh", 1, "")).toThrow(/safe path segments/);
    expect(() => attemptArtifactPath("auth-refresh", 1, null as unknown as string)).toThrow(/safe path segments/);
    expect(() => attemptArtifactPath("auth-refresh", 1, "../escape")).toThrow(/safe path segments/);
    expect(() => attemptArtifactPath("auth-refresh", 1, "reviews/latest.json")).toThrow(/safe path segments/);
    expect(() => remediationRecordPath("auth-refresh", 0)).toThrow(/attempt one or later/);
  });
});
