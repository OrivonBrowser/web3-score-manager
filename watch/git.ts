import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Config } from "./config.ts";
import { failed, run } from "./proc.ts";

export class GitError extends Error {}

function gitEnv(config: Config): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/",
    GIT_AUTHOR_NAME: config.gitName,
    GIT_AUTHOR_EMAIL: config.gitEmail,
    GIT_COMMITTER_NAME: config.gitName,
    GIT_COMMITTER_EMAIL: config.gitEmail,
    GIT_TERMINAL_PROMPT: "0",
  };
  if (config.deployKey !== undefined) {
    env.GIT_SSH_COMMAND = `ssh -i ${config.deployKey} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`;
  }
  return env;
}

/** Runs git in the data clone and returns its output; a failure carries git's first error line. */
export async function git(config: Config, args: string[], timeoutMs = 120_000): Promise<string> {
  const result = await run("git", args, { cwd: config.repoDir, env: gitEnv(config), timeoutMs });
  if (failed(result)) {
    const line = result.stderr.trim().split("\n").filter((l) => l !== "").pop() ?? `exit code ${result.code}`;
    throw new GitError(`git ${args[0]} failed: ${line.slice(0, 200)}`);
  }
  return result.stdout.trim();
}

/** The dedicated clone, brought to origin/main and cleaned of anything an earlier run left. */
export async function syncClone(config: Config): Promise<void> {
  if (!existsSync(path.join(config.repoDir, ".git"))) {
    mkdirSync(path.dirname(config.repoDir), { recursive: true });
    const cloned = await run("git", ["clone", config.gitRemote, config.repoDir], { env: gitEnv(config), timeoutMs: 300_000 });
    if (failed(cloned)) throw new GitError(`git clone failed: ${cloned.stderr.trim().split("\n").pop()?.slice(0, 200) ?? ""}`);
  }
  await git(config, ["fetch", "--prune", "origin", "main"]);
  await git(config, ["checkout", "-f", "-B", "main", "origin/main"]);
  await git(config, ["clean", "-fdq"]);
}

export async function headSha(config: Config): Promise<string> {
  return git(config, ["rev-parse", "HEAD"]);
}

export interface CommitInput {
  file: string;
  content: string;
  subject: string;
  body: string;
}

/** Writes the evaluation, runs `check` on the clone, and commits it. A judgement that fails `check` is undone. */
export async function commitEvaluation(config: Config, input: CommitInput): Promise<string> {
  writeFileSync(input.file, input.content);
  const check = await run(config.nodeBin, ["src/cli.ts", "check"], { cwd: config.repoDir, timeoutMs: 120_000 });
  if (failed(check)) {
    await git(config, ["checkout", "--", path.relative(config.repoDir, input.file)]).catch(() => {});
    const lines = (check.stderr || check.stdout).trim().split("\n").slice(0, 5).join("; ");
    throw new GitError(`the judgement does not pass check: ${lines.slice(0, 400)}`);
  }
  await git(config, ["add", "--", path.relative(config.repoDir, input.file)]);
  await git(config, ["commit", "-q", "-m", input.subject, "-m", input.body, "-m", "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"]);
  return headSha(config);
}

/** Pushes HEAD to main; a rejected push is fetched, rebased onto origin/main and checked again, up to three times. */
export async function pushMain(config: Config): Promise<string> {
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await git(config, ["push", "origin", "HEAD:main"], 180_000);
      return await headSha(config);
    } catch (e) {
      lastError = (e as Error).message;
    }
    await git(config, ["fetch", "origin", "main"]);
    try {
      await git(config, ["rebase", "origin/main"]);
    } catch (e) {
      await git(config, ["rebase", "--abort"]).catch(() => {});
      throw new GitError(`the push was rejected and the rebase failed: ${(e as Error).message}`);
    }
    const check = await run(config.nodeBin, ["src/cli.ts", "check"], { cwd: config.repoDir, timeoutMs: 120_000 });
    if (failed(check)) throw new GitError("after the rebase the provider no longer passes check");
  }
  throw new GitError(`the push kept being rejected: ${lastError}`);
}

/** Puts the commit on its own branch from origin/main and pushes it, for the owner to review; main is restored. */
export async function pushBranch(config: Config, branch: string, input: CommitInput, push: boolean): Promise<string> {
  await git(config, ["checkout", "-f", "-B", branch, "origin/main"]);
  try {
    const sha = await commitEvaluation(config, input);
    if (push) await git(config, ["push", "--force", "origin", `HEAD:refs/heads/${branch}`], 180_000);
    return sha;
  } finally {
    await git(config, ["checkout", "-f", "main"]).catch(() => {});
  }
}

/** Dry runs commit locally; this puts the clone back where origin has it. */
export async function resetToOrigin(config: Config): Promise<void> {
  await git(config, ["checkout", "-f", "main"]);
  await git(config, ["reset", "-q", "--hard", "origin/main"]);
}
