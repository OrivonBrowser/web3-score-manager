import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Config } from "./config.ts";
import { failed, run } from "./proc.ts";

/** What the sandboxed processes cannot read. /tmp is not here: srt keeps its proxy socket and CA bundle there. */
export const DENY_READ = ["/home", "/root", "/srv", "/run", "/var/run", "/var/lib", "/var/log", "/etc/attila-watch", "/etc/ssh", "/etc/sudoers.d", "/opt/attila-watch/secrets"];

export interface Job {
  dir: string;
  input: string;
  output: string;
  home: string;
  tmp: string;
}

function stamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
}

/** A job directory with its four folders, group-writable for the judge user's group. */
export async function createJob(config: Config, slug: string, now: Date): Promise<Job> {
  const dir = path.join(config.jobsDir, `${stamp(now)}-${slug}`);
  const job: Job = { dir, input: path.join(dir, "input"), output: path.join(dir, "output"), home: path.join(dir, "home"), tmp: path.join(dir, "tmp") };
  const all = [dir, job.input, job.output, job.home, job.tmp];
  try {
    mkdirSync(dir, { recursive: true });
    for (const d of all) {
      mkdirSync(d, { recursive: true });
      chmodSync(d, 0o2770);
    }
  } catch {
    const made = await run("sudo", ["-n", "install", "-d", "-g", config.judgeGroup, "-m", "2770", ...all]);
    if (failed(made)) throw new Error("the job directory could not be created");
  }
  return job;
}

function settings(job: Job, network: Record<string, unknown>, extra: Record<string, unknown>): string {
  return `${JSON.stringify(
    {
      network: { deniedDomains: [], allowAllUnixSockets: true, ...network },
      filesystem: { denyRead: DENY_READ, allowRead: [], allowWrite: [job.output, job.home, job.tmp], denyWrite: [] },
      ...extra,
    },
    null,
    2,
  )}\n`;
}

/** The two srt settings files, written into the job root by the orchestrator, never by the sandbox. */
export function writeSrtSettings(job: Job): void {
  writeFileSync(path.join(job.dir, "srt-probe.json"), settings(job, { allowedDomains: [] }, {}));
  writeFileSync(
    path.join(job.dir, "srt-judge.json"),
    settings(job, { allowedDomains: ["api.anthropic.com"], tlsTerminate: {} }, { credentials: { envVars: [{ name: "CLAUDE_CODE_OAUTH_TOKEN", mode: "mask" }] } }),
  );
}

export function probeCommand(config: Config, job: Job, cid: string): { command: string; args: string[] } {
  return {
    command: "sudo",
    args: [
      "-n",
      "-u",
      config.judgeUser,
      "--",
      config.srtBin,
      "--settings",
      path.join(job.dir, "srt-probe.json"),
      "--",
      "env",
      `HOME=${job.home}`,
      `TMPDIR=${job.tmp}`,
      `PLAYWRIGHT_BROWSERS_PATH=${config.playwrightBrowsersPath}`,
      config.nodeBin,
      path.join(config.appDir, "watch", "probe.ts"),
      path.join(job.input, "site"),
      job.output,
      cid,
    ],
  };
}

/** `ipfs get` as the judge user, so what the site holds is never written by the orchestrator's account. */
export function fetchCommand(config: Config, cid: string, dest: string, timeoutS: number): { command: string; args: string[] } {
  return {
    command: "sudo",
    args: ["-n", "-u", config.judgeUser, "--", config.ipfsBin, "--api", config.ipfsApiMultiaddr, `--timeout=${timeoutS}s`, "get", `/ipfs/${cid}`, "-o", dest],
  };
}

/** Removes a directory below the jobs directory; the judge user owns some of what it holds, so it deletes what the orchestrator cannot. */
export async function removeTree(config: Config, dir: string): Promise<void> {
  if (!dir.startsWith(`${config.jobsDir}/`)) throw new Error("refusing to delete outside the jobs directory");
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    await run("sudo", ["-n", "-u", config.judgeUser, "--", "rm", "-rf", "--", dir]);
  }
}

/** Deletes all but the newest `keepJobs` job directories. */
export async function pruneJobs(config: Config): Promise<void> {
  if (!existsSync(config.jobsDir)) return;
  const names = readdirSync(config.jobsDir).filter((n) => /^\d{8}-\d{6}-/.test(n)).sort();
  for (const name of names.slice(0, Math.max(0, names.length - config.keepJobs))) {
    await removeTree(config, path.join(config.jobsDir, name));
  }
}
