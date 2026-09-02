import { describe, expect, it } from "vitest";
import { validateReview, validateState, validationDetails } from "../src/domain/validation.js";

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

  it("accepts a structured review", () => {
    expect(validateReview({
      schemaVersion: 1,
      workId: "auth-refresh",
      reviewer: "agent:reviewer",
      digest: "0000000000000000000000000000000000000000000000000000000000000000",
      verdict: "pass",
      findings: [],
    })).toBe(true);
  });
});
