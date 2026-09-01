import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/cli.js";

const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

afterEach(() => {
  log.mockClear();
  error.mockClear();
});

describe("CLI", () => {
  it("prints its version", () => {
    expect(run(["--version"])).toBe(0);
    expect(log).toHaveBeenCalledWith("0.1.0");
  });

  it("rejects unknown commands", () => {
    expect(run(["unknown"])).toBe(1);
    expect(error).toHaveBeenCalledWith("Unknown command: unknown");
  });
});
