import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: { WAYS_CLI: resolve("dist/cli.js") },
  },
});
