#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { bootstrap } from "./bootstrap/bootstrap.js";
import { runChecks } from "./check/check.js";
import { HARNESS_NAME, HARNESS_VERSION } from "./index.js";
import { queryKnowledge } from "./query/query.js";
import { loadState } from "./state/store.js";
import { abandonPlan, finishPlan, proposePlan, startPlan } from "./work/plan.js";
import { cancelQuick, finishQuick, startQuick } from "./work/quick.js";
import { submitReview } from "./work/review.js";
import { advanceSdd, downgradeSdd, startSdd } from "./work/sdd.js";
import { addTask, integrateTask, prepareTask } from "./work/tasks.js";

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

  if (command === "status") {
    const state = await loadState(cwd);
    console.log(state ? JSON.stringify(state, null, 2) : "No active mutating work.");
    return 0;
  }

  if (command === "review") {
    const [action, path] = args;
    if (action === "submit" && path) {
      const result = await submitReview(cwd, path);
      console.log(`Review recorded: ${result.verdict}`);
      return 0;
    }
    throw new Error("Usage: ways review submit <review.json>");
  }

  if (command === "task") {
    const [action, id] = args;
    if (action === "add" && id) {
      const title = args.find((arg) => arg.startsWith("--title="))?.slice(8) ?? "";
      const dependencies = args.find((arg) => arg.startsWith("--depends="))?.slice(10).split(",").filter(Boolean) ?? [];
      console.log(JSON.stringify(await addTask(cwd, id, title, dependencies), null, 2));
      return 0;
    }
    if (action === "prepare" && id) {
      console.log(JSON.stringify(await prepareTask(cwd, id), null, 2));
      return 0;
    }
    if (action === "integrate" && id) {
      const commits = args.find((arg) => arg.startsWith("--commits="))?.slice(10).split(",").filter(Boolean) ?? [];
      console.log(JSON.stringify(await integrateTask(cwd, id, commits), null, 2));
      return 0;
    }
    throw new Error("Usage: ways task add <id> --title=<text> [--depends=a,b] | prepare <id> | integrate <id> --commits=a,b");
  }

  if (command === "sdd") {
    const [action, id] = args;
    if (action === "start" && id) {
      const profile = args.includes("--supervised") ? "supervised" : "autonomous";
      const state = await startSdd(cwd, id, profile);
      console.log(`SDD started at ${state.phase} (${profile}).`);
      return 0;
    }
    if (action === "advance") {
      console.log(`SDD gate committed: ${await advanceSdd(cwd, args.includes("--approved"))}`);
      return 0;
    }
    if (action === "downgrade" && (id === "quick" || id === "plan")) {
      console.log(`SDD downgraded: ${await downgradeSdd(cwd, id)}`);
      return 0;
    }
    throw new Error("Usage: ways sdd start <id> [--supervised] | advance [--approved] | downgrade <quick|plan>");
  }

  if (command === "check") {
    const result = await runChecks(cwd, args.includes("--integrity-only"));
    for (const issue of result.issues) console.error(`${issue.code}: ${issue.path}: ${issue.message}`);
    if (result.issues.length > 0 || (result.testExitCode !== undefined && result.testExitCode !== 0)) return 1;
    console.log("Checks passed.");
    return 0;
  }

  if (command === "plan") {
    const [action, id] = args;
    if (action === "start" && id) {
      const state = await startPlan(cwd, id);
      console.log(`Plan started: ${state.planPath}`);
      return 0;
    }
    if (action === "propose") {
      console.log(`Plan committed: ${await proposePlan(cwd)}`);
      return 0;
    }
    if (action === "finish") {
      const message = args.find((arg) => arg.startsWith("--message="))?.slice(10) ?? "";
      const memory = args.find((arg) => arg.startsWith("--memory="))?.slice(9);
      console.log(`Plan completed: ${await finishPlan(cwd, message, memory as "updated" | "unchanged")}`);
      return 0;
    }
    if (action === "abandon") {
      console.log(`Plan abandoned: ${await abandonPlan(cwd)}`);
      return 0;
    }
    throw new Error("Usage: ways plan start <id> | propose | finish --message=<subject> --memory=<updated|unchanged> | abandon");
  }

  if (command === "quick") {
    const [action, id] = args;
    if (action === "start" && id) {
      await startQuick(cwd, id);
      console.log(`Quick work started: ${id}`);
      return 0;
    }
    if (action === "finish") {
      const message = args.find((arg) => arg.startsWith("--message="))?.slice(10) ?? "";
      const memory = args.find((arg) => arg.startsWith("--memory="))?.slice(9);
      const commit = await finishQuick(cwd, message, memory as "updated" | "unchanged");
      console.log(`Quick work committed: ${commit}`);
      return 0;
    }
    if (action === "cancel") {
      await cancelQuick(cwd);
      console.log("Quick work cancelled; project changes were preserved.");
      return 0;
    }
    throw new Error("Usage: ways quick start <id> | finish --message=<subject> --memory=<updated|unchanged> | cancel");
  }

  if (command === "query") {
    const query = args.join(" ").trim();
    if (!query) throw new Error("Usage: ways query <terms>");
    const hits = await queryKnowledge(cwd, query);
    for (const hit of hits) console.log(`${hit.score}\t${hit.path}\t${hit.preview}`);
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
