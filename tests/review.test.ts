import { describe, expect, it } from "vitest";
import { reviewBlocks } from "../src/work/review.js";

describe("review gate", () => {
  it("blocks unresolved severe findings", () => {
    expect(reviewBlocks({
      schemaVersion: 1,
      workId: "x",
      reviewer: "independent-agent",
      verdict: "pass",
      findings: [{ id: "F1", severity: "high", summary: "Broken", disposition: "accepted" }],
    })).toContain("F1");
  });

  it("requires disposition for minor findings", () => {
    expect(reviewBlocks({
      schemaVersion: 1,
      workId: "x",
      reviewer: "independent-agent",
      verdict: "pass",
      findings: [{ id: "F2", severity: "low", summary: "Naming", disposition: "deferred" }],
    })).toEqual([]);
  });
});
