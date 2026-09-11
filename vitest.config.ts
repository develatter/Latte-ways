import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    env: { WAYS_CLI: resolve("dist/cli.js") },
    testTimeout: 30_000,
  },
});
