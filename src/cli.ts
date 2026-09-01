#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { bootstrap } from "./bootstrap/bootstrap.js";
import { HARNESS_NAME, HARNESS_VERSION } from "./index.js";

export async function run(argv: readonly string[], cwd = process.cwd()): Promise<number> {
  const [command, ...args] = argv;

  if (command === "--version" || command === "-v" || command === "version") {
    console.log(HARNESS_VERSION);
    return 0;
  }

  if (command === "--help" || command === "-h" || command === undefined) {
    console.log(`${HARNESS_NAME} ${HARNESS_VERSION}\n\nUsage: ways <command>`);
    return 0;
  }

  if (command === "bootstrap") {
    const force = args.includes("--force");
    const testOption = args.find((arg) => arg.startsWith("--test-command="));
    const testCommand = testOption ? JSON.parse(testOption.slice("--test-command=".length)) as unknown : ["npm", "test"];
    if (!Array.isArray(testCommand) || !testCommand.every((part) => typeof part === "string")) {
      throw new Error("--test-command must be a JSON string array");
    }
    await bootstrap({ cwd, testCommand, force });
    console.log("Harness bootstrapped.");
    return 0;
  }

  console.error(`Unknown command: ${command}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
