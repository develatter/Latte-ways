import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mergeClaudeSettings, renderClaude } from "../src/adapters/claude.js";
import { installAdapter, PROVIDERS } from "../src/adapters/install.js";
import { loadAdapterSource, MAX_ROLE_LINES, nonEmptyLines } from "../src/adapters/source.js";
import { bootstrap } from "../src/bootstrap/bootstrap.js";
import { GitRepository } from "../src/git/git.js";
import { checkIntegrity } from "../src/integrity/integrity.js";
import { applyUpgrade, planUpgrade } from "../src/upgrade/upgrade.js";
import { startSdd } from "../src/work/sdd.js";

const ROLES = ["orchestrator", "explorer", "implementer", "reviewer", "qa-unit", "qa-mutation", "sweeper"];
const COMMANDS = ["status", "query", "quick", "finish", "cancel", "plan", "sdd", "advance"];

async function repository(): Promise<{ cwd: string; git: GitRepository }> {
  const cwd = await mkdtemp(join(tmpdir(), "ways-adapter-"));
  const git = new GitRepository(cwd);
  await git.run(["init", "-q"]);
  await git.run(["config", "user.name", "Ways Test"]);
  await git.run(["config", "user.email", "ways@example.test"]);
  await writeFile(join(cwd, ".gitkeep"), "");
  await git.run(["add", ".gitkeep"]);
  await git.run(["commit", "-q", "-m", "initial"]);
  return { cwd, git };
}

describe("canonical adapter source", () => {
  it("loads every role and command with bounded prompts", async () => {
    const source = await loadAdapterSource();
    expect(source.roles.map((role) => role.name).sort()).toEqual([...ROLES].sort());
    expect(source.commands.map((command) => command.name).sort()).toEqual([...COMMANDS].sort());
    for (const role of source.roles) expect(nonEmptyLines(role.body).length).toBeLessThanOrEqual(MAX_ROLE_LINES);
    expect(source.roles.filter((role) => role.access === "read").map((role) => role.name).sort()).toEqual(["explorer", "qa-mutation", "reviewer"]);
  });

  it("rejects prompts longer than six lines", async () => {
    const root = await mkdtemp(join(tmpdir(), "ways-source-"));
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(root, "commands"));
    await mkdir(join(root, "roles"));
    await writeFile(join(root, "statusline.sh"), "");
    await writeFile(join(root, "guard.sh"), "");
    await writeFile(join(root, "roles", "long.md"), `---\ndescription: x\naccess: read\n---\n${"line\n".repeat(7)}`);
    await expect(loadAdapterSource(root)).rejects.toThrow(/exceeds 6/);
  });
});

describe("claude renderer", () => {
  it("renders commands, read-only agents, statusline and guard", async () => {
    const files = renderClaude(await loadAdapterSource());
    const byPath = new Map(files.map((file) => [file.path, file]));
    expect(byPath.get(".claude/commands/ways-quick.md")?.content).toMatch(/^---\ndescription: .*\nargument-hint: <id> \[what to change\]\n---\n/);
    expect(byPath.get(".claude/agents/ways-reviewer.md")?.content).toContain("permissionMode: plan");
    expect(byPath.get(".claude/agents/ways-implementer.md")?.content).not.toContain("permissionMode");
    expect(byPath.get(".claude/ways-statusline.sh")?.mode).toBe(0o755);
    expect(byPath.get(".claude/ways-guard.sh")?.mode).toBe(0o755);
  });

  it("merges settings without dropping user keys and stays idempotent", () => {
    const once = mergeClaudeSettings({ theme: "dark", hooks: { PreToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "mine.sh" }] }] } });
    const twice = mergeClaudeSettings(once);
    expect(twice).toEqual(once);
    expect(once.theme).toBe("dark");
    const groups = (once.hooks as { PreToolUse: Array<{ hooks: Array<{ command: string }> }> }).PreToolUse;
    expect(groups.flatMap((group) => group.hooks.map((hook) => hook.command))).toEqual(["mine.sh", ".claude/ways-guard.sh"]);
  });
});

describe("adapter installation", () => {
  it("bootstrap renders every provider and integrity guards the files", async () => {
    const { cwd } = await repository();
    const manifest = await bootstrap({ cwd, testCommand: [process.execPath, "-e", "process.exit(0)"] });
    expect(Object.keys(manifest.adapters ?? {})).toEqual(PROVIDERS.map((adapter) => adapter.id));
    expect(Object.keys(manifest.adapters?.claude ?? {})).toHaveLength(COMMANDS.length + ROLES.length + 2);
    expect(await checkIntegrity(cwd)).toEqual([]);
    await writeFile(join(cwd, ".claude/agents/ways-reviewer.md"), "tampered\n");
    expect((await checkIntegrity(cwd)).map((issue) => issue.code)).toContain("adapter-file-modified");
  });

  it("refuses to overwrite unmanaged files unless forced, and upgrade re-renders", async () => {
    const { cwd } = await repository();
    await bootstrap({ cwd, testCommand: [process.execPath, "-e", "process.exit(0)"], adapters: false });
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(cwd, ".claude", "commands"), { recursive: true });
    await writeFile(join(cwd, ".claude/commands/ways-quick.md"), "mine\n");
    await expect(installAdapter(cwd, "claude")).rejects.toThrow(/Refusing to overwrite/);
    await installAdapter(cwd, "claude", true);
    await writeFile(join(cwd, ".claude/commands/ways-quick.md"), "tampered\n");
    expect((await planUpgrade(cwd)).modifiedManagedFiles).toEqual([".claude/commands/ways-quick.md"]);
    await expect(applyUpgrade(cwd, new Set())).rejects.toThrow(/overwrite approval/);
    await applyUpgrade(cwd, new Set([".claude/commands/ways-quick.md"]));
    expect(await readFile(join(cwd, ".claude/commands/ways-quick.md"), "utf8")).not.toBe("tampered\n");
    expect(await checkIntegrity(cwd)).toEqual([]);
  });

  it("statusline and guard read the status artifact with plain shell", async () => {
    const { cwd } = await repository();
    await bootstrap({ cwd, testCommand: [process.execPath, "-e", "process.exit(0)"] });
    const run = (script: string, payload: unknown): { stdout: string; code: number } => {
      try {
        return { stdout: execFileSync("sh", [join(cwd, script)], { cwd, input: JSON.stringify(payload), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }), code: 0 };
      } catch (error) {
        const failure = error as { status: number; stdout: string };
        return { stdout: failure.stdout, code: failure.status };
      }
    };
    expect(run(".claude/ways-statusline.sh", { workspace: { project_dir: cwd } }).stdout).toBe("ways: idle");
    expect(run(".claude/ways-guard.sh", { tool_input: { command: "git add . && git commit -m x" }, cwd }).code).toBe(2);
    expect(run(".claude/ways-guard.sh", { tool_input: { command: "git log" }, cwd }).code).toBe(0);
    const git = new GitRepository(cwd);
    await git.run(["add", "."]);
    await git.run(["commit", "-q", "-m", "bootstrap"]);
    await startSdd(cwd, "demo", "supervised");
    expect(run(".claude/ways-statusline.sh", { workspace: { project_dir: cwd } }).stdout).toBe("ways: sdd:demo @intake [supervised] HUMAN GATE");
    expect(run(".claude/ways-guard.sh", { tool_input: { command: "git commit -m x" }, cwd }).code).toBe(0);
  });
});
