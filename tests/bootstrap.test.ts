import { mkdtemp, readFile, readlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bootstrap } from "../src/bootstrap/bootstrap.js";
import { GitRepository } from "../src/git/git.js";

async function repository(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "ways-bootstrap-"));
  const git = new GitRepository(cwd);
  await git.run(["init", "-q"]);
  await git.run(["config", "user.name", "Ways Test"]);
  await git.run(["config", "user.email", "ways@example.test"]);
  await writeFile(join(cwd, ".gitkeep"), "");
  await git.run(["add", ".gitkeep"]);
  await git.run(["commit", "-q", "-m", "initial"]);
  return cwd;
}

describe("bootstrap", () => {
  it("installs the complete portable contract", async () => {
    const cwd = await repository();
    const manifest = await bootstrap({ cwd, testCommand: ["npm", "test"] });
    expect(await readlink(join(cwd, "CLAUDE.md"))).toBe("AGENTS.md");
    expect(await readFile(join(cwd, "scripts/check.sh"), "utf8")).toContain("ways check");
    expect(manifest.managedFiles["AGENTS.md"]).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(await readFile(join(cwd, ".ways/config.json"), "utf8")).testCommand).toEqual(["npm", "test"]);
  });

  it("does not silently overwrite managed files", async () => {
    const cwd = await repository();
    await bootstrap({ cwd, testCommand: ["npm", "test"] });
    await expect(bootstrap({ cwd, testCommand: ["npm", "test"] })).rejects.toThrow("overwrite");
  });
});
