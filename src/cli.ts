#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { HARNESS_NAME, HARNESS_VERSION } from "./index.js";

export function run(argv: readonly string[]): number {
  const [command] = argv;

  if (command === "--version" || command === "-v" || command === "version") {
    console.log(HARNESS_VERSION);
    return 0;
  }

  if (command === "--help" || command === "-h" || command === undefined) {
    console.log(`${HARNESS_NAME} ${HARNESS_VERSION}\n\nUsage: ways <command>`);
    return 0;
  }

  console.error(`Unknown command: ${command}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run(process.argv.slice(2));
}
