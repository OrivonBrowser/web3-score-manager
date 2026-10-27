import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../../test/support.ts";
import type { Config } from "../config.ts";
import { commitEvaluation, GitError } from "../git.ts";

/** A clone with one tracked evaluation, and a config whose `check` always fails. */
function failingCheckRepo(): { config: Config; tracked: string; untracked: string } {
  const repoDir = tempDir();
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repoDir, stdio: "pipe" });
  git("init", "-q");
  const tracked = path.join(repoDir, "provider", "scores", "website", "app.json");
  mkdirSync(path.dirname(tracked), { recursive: true });
  writeFileSync(tracked, "original\n");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "start");
  const config = { repoDir, appDir: repoDir, nodeBin: "/bin/false", gitName: "t", gitEmail: "t@example.com", githubToken: undefined, deployKey: undefined } as unknown as Config;
  return { config, tracked, untracked: path.join(path.dirname(tracked), "app-2.json") };
}

const input = (file: string) => ({ file, content: "{}\n", subject: "s", body: "b" });

test("a new evaluation file that fails check is removed", async () => {
  const { config, untracked } = failingCheckRepo();
  await assert.rejects(commitEvaluation(config, input(untracked)), GitError);
  assert.equal(existsSync(untracked), false);
});

test("a tracked evaluation file that fails check gets its content back", async () => {
  const { config, tracked } = failingCheckRepo();
  await assert.rejects(commitEvaluation(config, input(tracked)), GitError);
  assert.equal(readFileSync(tracked, "utf8"), "original\n");
});
