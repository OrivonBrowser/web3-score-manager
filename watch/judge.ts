import { readFileSync } from "node:fs";
import path from "node:path";
import { ETH_NAME } from "../src/validate.ts";
import type { Config } from "./config.ts";
import { run } from "./proc.ts";

/**
 * Every flag of the judge's command line, in one place. Adjust here after a live test; the
 * orchestrator builds the rest of the command around them.
 */
export const JUDGE_ENV = [
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1",
  "DISABLE_AUTOUPDATER=1",
  "DISABLE_TELEMETRY=1",
  "DISABLE_ERROR_REPORTING=1",
];
export const JUDGE_SETTINGS = '{"disableAllHooks":true,"permissions":{"blockReadsOutsideWorkingDirectories":true}}';

/** The flags of `claude`, in the order the spec gives them. */
export function judgeFlags(model: string, maxTurns: number, schemaMin: string): string[] {
  return [
    "-p",
    "--model",
    model,
    "--restricted",
    "--tools",
    "Read,Grep,Glob",
    "--disallowedTools",
    "mcp__*",
    "--permission-mode",
    "dontAsk",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--max-turns",
    String(maxTurns),
    "--settings",
    JUDGE_SETTINGS,
    "--output-format",
    "json",
    "--json-schema",
    schemaMin,
  ];
}

export interface JudgePaths {
  /** The job directory. */
  dir: string;
  input: string;
}

export interface JudgeParams {
  name: string;
  cid: string;
  today: string;
}

/** The name and CID are values the watch has validated, never site text; they are the only things put into the prompt. */
export function renderPrompt(template: string, p: JudgeParams): string {
  const names = p.name.split(", ");
  if (names.length < 1 || !names.every((n) => ETH_NAME.test(n))) throw new Error("the name is not a lowercase .eth name");
  if (!/^[a-z0-9]{10,100}$/.test(p.cid)) throw new Error("the CID is not a plain lowercase string");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.today)) throw new Error("today is not a date");
  return template.replaceAll("{{name}}", p.name).replaceAll("{{cid}}", p.cid).replaceAll("{{today}}", p.today);
}

export function readSchema(appDir: string): string {
  const file = path.join(appDir, "watch", "judge", "schema.json");
  return JSON.stringify(JSON.parse(readFileSync(file, "utf8")));
}

export function readTemplate(appDir: string): string {
  return readFileSync(path.join(appDir, "watch", "judge", "prompt.md"), "utf8");
}

/** The program and arguments that run the judge inside the sandbox as the judge user. */
export function judgeCommand(config: Config, job: JudgePaths, schemaMin: string): { command: string; args: string[] } {
  const args = [
    "-n",
    "-u",
    config.judgeUser,
    "--preserve-env=CLAUDE_CODE_OAUTH_TOKEN",
    "--",
    config.srtBin,
    "--settings",
    path.join(job.dir, "srt-judge.json"),
    "--",
    "env",
    `HOME=${job.dir}/home`,
    `TMPDIR=${job.dir}/tmp`,
    `CLAUDE_CONFIG_DIR=${job.dir}/home/.claude`,
    `CLAUDE_CODE_TMPDIR=${job.dir}/tmp`,
    ...JUDGE_ENV,
    "timeout",
    String(config.judgeTimeoutS),
    config.claudeBin,
    ...judgeFlags(config.model, config.maxTurns, schemaMin),
  ];
  return { command: "sudo", args };
}

export interface JudgeRun {
  ok: boolean;
  /** Why it did not produce an answer; never holds the answer. */
  error?: string;
  stdout: string;
  stderr: string;
  answer?: unknown;
  costUsd?: number;
  turns?: number;
}

/** Runs the judge with the prompt on stdin and reads its structured answer from the JSON the CLI prints. */
export async function runJudge(config: Config, job: JudgePaths, prompt: string): Promise<JudgeRun> {
  const { command, args } = judgeCommand(config, job, readSchema(config.appDir));
  const env: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin" };
  if (config.oauthToken !== undefined) env.CLAUDE_CODE_OAUTH_TOKEN = config.oauthToken;
  const result = await run(command, args, {
    cwd: job.input,
    env,
    stdin: prompt,
    timeoutMs: (config.judgeTimeoutS + 60) * 1000,
    maxStdout: 2 * 1024 * 1024,
    maxStderr: 64 * 1024,
  });
  const base = { stdout: result.stdout, stderr: result.stderr };
  if (result.spawnError) return { ok: false, error: "the judge could not be started", ...base };
  if (result.timedOut || result.code === 124) return { ok: false, error: "the judge ran out of time", ...base };
  if (result.stdoutTruncated) return { ok: false, error: "the judge's output was too large", ...base };
  let parsed: { structured_output?: unknown; is_error?: unknown; subtype?: unknown; total_cost_usd?: unknown; num_turns?: unknown };
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { ok: false, error: `the judge exited with code ${result.code} and printed no JSON`, ...base };
  }
  const costUsd = typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : undefined;
  const turns = typeof parsed.num_turns === "number" ? parsed.num_turns : undefined;
  if (parsed.structured_output === undefined || parsed.is_error === true) {
    const why = typeof parsed.subtype === "string" ? parsed.subtype.slice(0, 60) : `exit code ${result.code}`;
    return { ok: false, error: `the judge gave no structured answer (${why})`, costUsd, turns, ...base };
  }
  return { ok: true, answer: parsed.structured_output, costUsd, turns, ...base };
}
