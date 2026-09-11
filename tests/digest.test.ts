import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { GitRepository } from "../src/git/git.js";
import { committedWorkDigest, workDigest } from "../src/work/digest.js";

it.each(["myers", "histogram"])("preserves digests across %s ambient algorithm and prefix settings", async (algorithm) => {
  const cwd = await mkdtemp(join(tmpdir(), "ways-digest-"));
  const git = new GitRepository(cwd);
  await git.run(["init", "-q"]);
  await git.run(["config", "user.name", "Ways Test"]);
  await git.run(["config", "user.email", "ways@example.test"]);
  await git.run(["config", "diff.algorithm", algorithm]);
  await git.run(["config", "diff.mnemonicPrefix", "false"]);
  await git.run(["config", "diff.noprefix", "false"]);
  await writeFile(join(cwd, "content.txt"), "one\ntwo\nthree\n");
  await git.commit(["content.txt"], "base", {});
  const base = await git.head();
  await writeFile(join(cwd, "content.txt"), "one\nTWO\nthree\n");
  // Reference digest with explicitly pinned settings: whatever the ambient
  // git config is, the harness digest must equal this, so a digest recorded
  // on one machine replays on any other.
  const canonical = await git.run(["diff", "--binary", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", "--diff-algorithm=histogram", base]);
  const expected = createHash("sha256").update(canonical).digest("hex");
  expect(await workDigest(cwd, base)).toBe(expected);
  await git.run(["config", "diff.algorithm", algorithm === "myers" ? "histogram" : "myers"]);
  await git.run(["config", "diff.mnemonicPrefix", "true"]);
  expect(await workDigest(cwd, base)).toBe(expected);
  await git.run(["config", "diff.noprefix", "true"]);
  expect(await workDigest(cwd, base)).toBe(expected);
  await git.commit(["content.txt"], "change", {});
  expect(await committedWorkDigest(git, base, "HEAD")).toBe(expected);
  expect(await workDigest(cwd, base)).toBe(expected);
});
