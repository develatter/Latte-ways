import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { bootstrap } from "../src/bootstrap/bootstrap.js";
import { GitRepository } from "../src/git/git.js";
import { applyUpgrade, planUpgrade } from "../src/upgrade/upgrade.js";

it("requires checklist approval before restoring modified managed files", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "ways-upgrade-"));
  const git = new GitRepository(cwd);
  await git.run(["init", "-q"]);
  await git.run(["config", "user.name", "Ways Test"]);
  await git.run(["config", "user.email", "ways@example.test"]);
  await writeFile(join(cwd, ".gitkeep"), "");
  await git.run(["add", ".gitkeep"]);
  await git.run(["commit", "-q", "-m", "initial"]);
  await bootstrap({ cwd, testCommand: ["npm", "test"] });
  const original = await readFile(join(cwd, "AGENTS.md"), "utf8");
  await writeFile(join(cwd, "AGENTS.md"), "modified\n");
  expect((await planUpgrade(cwd)).modifiedManagedFiles).toContain("AGENTS.md");
  await expect(applyUpgrade(cwd, new Set())).rejects.toThrow("[ ] AGENTS.md");
  await applyUpgrade(cwd, new Set(["AGENTS.md"]));
  expect(await readFile(join(cwd, "AGENTS.md"), "utf8")).toBe(original);
});
