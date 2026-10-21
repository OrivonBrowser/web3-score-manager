import { closeSync, copyFileSync, lstatSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadProvider, readJson } from "../src/source.ts";
import type { LoadedEvaluation } from "../src/source.ts";
import { checkNames, gatewayResolver } from "../src/moved.ts";
import type { NameState } from "../src/moved.ts";
import type { SourceEvaluation } from "../src/types.ts";
import { formatIssue } from "../src/types.ts";
import { validateSource } from "../src/validate.ts";
import { loadConfig, secretsOf } from "./config.ts";
import type { Config } from "./config.ts";
import { buildFacts, loadBuildRecord, renderFactsMd, saveBuildRecord } from "./facts.ts";
import { readRegularFile } from "./fsutil.ts";
import { commitEvaluation, headSha, pushBranch, pushMain, resetToOrigin, syncClone } from "./git.ts";
import { readTemplate, renderPrompt, runJudge } from "./judge.ts";
import { clip, log } from "./log.ts";
import { decide, mergeEvaluation, serialiseEvaluation } from "./merge.ts";
import { parseProbe } from "./probe-result.ts";
import type { ProbeSummary } from "./probe-result.ts";
import { failed, run } from "./proc.ts";
import { publish } from "./publish.ts";
import { createJob, fetchCommand, probeCommand, pruneJobs, removeTree, writeSrtSettings } from "./sandbox.ts";
import type { Job } from "./sandbox.ts";
import { loadState, markNotified, recordDone, recordFailure, runErrorDue, saveState, shouldSkip } from "./state.ts";
import type { State } from "./state.ts";
import { formatFailure, formatJudged, formatPublishFailure, formatRunError, telegramSender } from "./telegram.ts";
import type { JudgedMessage } from "./telegram.ts";
import { findSecrets, validateVerdict } from "./verdict.ts";

const RETRY_DELAY_MS = 30_000;
const CONNECTION_ERROR = /connect|reach|refused|reset|EOF|unreachable|daemon|no such host/i;

/** A site that could not be judged this time; the text is for the owner, so it never holds site text or secrets. */
class JobFailure extends Error {}

interface Group {
  file: string;
  names: string[];
  /** The build the names serve now, as `cid:<bare>`. */
  id: string;
}

type Result =
  | { kind: "done"; group: Group; message: JudgedMessage; levelBefore: number; levelAfter: number; branch?: string }
  | { kind: "rejected"; group: Group; reason: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryOnce<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch (e) {
    if (!(e instanceof Error) || !CONNECTION_ERROR.test(e.message)) throw e;
    log(`retrying in ${RETRY_DELAY_MS / 1000} s: ${clip(e.message)}`);
    await sleep(RETRY_DELAY_MS);
    return attempt();
  }
}

async function siteSize(config: Config, cid: string): Promise<number> {
  const url = `${config.ipfsApi}/api/v0/files/stat?arg=/ipfs/${cid}`;
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", signal: AbortSignal.timeout(config.statTimeoutS * 1000) });
  } catch (e) {
    const cause = (e as Error & { cause?: { message?: string } }).cause?.message ?? (e as Error).message;
    throw new Error(`the IPFS node could not be reached to size the build: ${cause}`);
  }
  if (!response.ok) throw new JobFailure(`the IPFS node could not size the build (HTTP ${response.status})`);
  const body = (await response.json()) as { CumulativeSize?: unknown };
  if (typeof body.CumulativeSize !== "number") throw new JobFailure("the IPFS node gave no size for the build");
  return body.CumulativeSize;
}

async function fetchBuild(config: Config, cid: string, dest: string, timeoutS: number): Promise<void> {
  const { command, args } = fetchCommand(config, cid, dest, timeoutS);
  const result = await run(command, args, { timeoutMs: (timeoutS + 30) * 1000, maxStderr: 16 * 1024 });
  if (failed(result)) {
    await removeTree(config, dest);
    throw new Error(result.timedOut ? "ipfs get ran out of time" : `ipfs get failed: ${clip(result.stderr, 150)}`);
  }
}

function isDirectory(p: string): boolean {
  try {
    const st = lstatSync(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

function slugOf(file: string): string {
  return path.basename(file, ".json");
}

function loadOne(file: string): SourceEvaluation {
  const read = readJson(file);
  if (read.issue) throw new JobFailure("the evaluation file could not be read");
  const checked = validateSource(read.value, file, "website");
  if (!checked.evaluation) throw new JobFailure("the evaluation file no longer passes check");
  return checked.evaluation;
}

function withoutSecrets(text: string, secrets: string[]): string {
  return findSecrets(text, secrets) ? "(withheld: it held something shaped like a secret)" : text;
}

async function judgeGroup(config: Config, group: Group, secrets: string[], now: Date): Promise<Result> {
  const cid = group.id.slice(4);
  const names = group.names.join(", ");
  const today = now.toISOString().slice(0, 10);
  const old = loadOne(group.file);
  const slug = slugOf(group.file);
  log(`judging ${names}: ${cid}`);

  const size = await retryOnce(() => siteSize(config, cid));
  if (size > config.siteMaxBytes) throw new JobFailure(`the build is too large (${Math.round(size / 1e6)} MB, the limit is ${Math.round(config.siteMaxBytes / 1e6)} MB)`);

  const job: Job = await createJob(config, slug, now);
  writeSrtSettings(job);
  const siteDir = path.join(job.input, "site");
  const previousDir = path.join(job.input, "previous");

  try {
    await retryOnce(() => fetchBuild(config, cid, siteDir, config.fetchTimeoutS));
  } catch (e) {
    throw new JobFailure(`the new build could not be fetched: ${clip((e as Error).message, 150)}`);
  }
  if (!isDirectory(siteDir)) throw new JobFailure("the new build is not a directory of files");

  const previousId = [...old.ids].reverse().find((id) => id.startsWith("cid:"));
  const previousCid = previousId?.slice(4) ?? null;
  let fetchedPrevious = false;
  if (previousCid !== null) {
    try {
      await fetchBuild(config, previousCid, previousDir, config.previousFetchTimeoutS);
      fetchedPrevious = isDirectory(previousDir);
    } catch (e) {
      log(`the previous build could not be fetched: ${clip((e as Error).message, 150)}`);
    }
  }

  const { facts, record } = buildFacts({
    cid,
    siteDir,
    previousCid,
    previousDir: fetchedPrevious ? previousDir : null,
    previousRecord: previousCid === null ? null : loadBuildRecord(config.stateDir, previousCid),
    savedAt: now.toISOString(),
  });
  if (facts.fileCount === 0) throw new JobFailure("the new build holds no files");
  try {
    saveBuildRecord(config.stateDir, record);
  } catch (e) {
    log(`the facts of the build could not be kept: ${clip((e as Error).message)}`);
  }
  writeFileSync(path.join(job.input, "facts.json"), `${JSON.stringify(facts, null, 2)}\n`);
  writeFileSync(path.join(job.input, "facts.md"), renderFactsMd(facts));

  const { command: probeBin, args: probeArgs } = probeCommand(config, job, cid);
  const probed = await run(probeBin, probeArgs, { timeoutMs: config.probeTimeoutS * 1000, maxStderr: 16 * 1024 });
  if (failed(probed)) {
    throw new JobFailure(probed.timedOut ? "the browser probe ran out of time" : `the browser probe failed: ${clip(withoutSecrets(probed.stderr, secrets), 150)}`);
  }
  const probeJson = readRegularFile(path.join(job.output, "probe.json"), 5 * 1024 * 1024);
  if (!probeJson) throw new JobFailure("the browser probe wrote no usable probe.json");
  const probe: ProbeSummary | null = parseProbe(probeJson.toString("utf8"));
  if (!probe) throw new JobFailure("the browser probe wrote a probe.json the watch cannot read");
  writeFileSync(path.join(job.input, "probe.json"), probeJson);
  const shot = readRegularFile(path.join(job.output, "screenshot.png"), 10 * 1024 * 1024);
  if (shot && shot.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    writeFileSync(path.join(job.input, "screenshot.png"), shot);
  } else log("the probe left no usable screenshot");

  copyFileSync(path.join(config.repoDir, "provider", "README.md"), path.join(job.input, "rules.md"));
  copyFileSync(group.file, path.join(job.input, "previous-evaluation.json"));

  const prompt = renderPrompt(readTemplate(config.appDir), { name: names, cid, today });
  const judged = await runJudge(config, { dir: job.dir, input: job.input }, prompt);
  const leaked = findSecrets(judged.stdout, secrets);
  if (!judged.ok || leaked) {
    if (!leaked && judged.stderr !== "" && !findSecrets(judged.stderr, secrets)) log(`judge stderr: ${clip(judged.stderr, 300)}`);
    throw new JobFailure(leaked ? "the answer contained a secret" : (judged.error ?? "the judge failed"));
  }
  const checked = validateVerdict(judged.answer);
  if (!checked.verdict) throw new JobFailure(`the answer did not pass validation: ${checked.issues.slice(0, 3).join("; ")}`);
  const verdict = checked.verdict;
  writeFileSync(path.join(job.dir, "judge-result.json"), `${judged.stdout}\n`);

  const merged = mergeEvaluation(old, verdict, cid, today);
  const decision = decide(old, merged, verdict, probe);
  if (decision.action === "reject") {
    return { kind: "rejected", group, reason: `${decision.reasons.join("; ")}${verdict.changes ? `. ${clip(verdict.changes, 300)}` : ""}` };
  }

  const subject = `Judge ${names}'s new build ${cid.slice(0, 12)}…`;
  const body = [
    `Level ${old.trustlessity.level} -> ${merged.trustlessity.level}${merged.trustlessity.privacy ? " with privacy" : ""}.`,
    ...(decision.action === "hold" ? ["", `Held for review: ${decision.reasons.join("; ")}.`] : []),
    "",
    `Judged by the Attila watch with ${config.model}.`,
  ].join("\n");
  const input = { file: group.file, content: serialiseEvaluation(merged), subject, body };
  const message: JudgedMessage = {
    name: names,
    cid,
    oldEval: old,
    newEval: merged,
    verdict,
    action: decision.action,
    reasons: decision.reasons,
    model: config.model,
    costUsd: judged.costUsd,
    turns: judged.turns,
    dryRun: config.dryRun,
  };
  const result: Result = { kind: "done", group, message, levelBefore: old.trustlessity.level, levelAfter: merged.trustlessity.level };
  if (decision.action === "apply") {
    try {
      let sha = await commitEvaluation(config, input);
      if (!config.dryRun) sha = await pushMain(config);
      message.commitUrl = `https://github.com/${config.githubRepo}/commit/${sha}`;
    } catch (e) {
      if (!config.dryRun) await resetToOrigin(config).catch(() => {});
      throw e;
    }
  } else {
    const branch = `attila-watch/${slug}-${cid.slice(0, 12)}`;
    await pushBranch(config, branch, input, !config.dryRun);
    result.branch = branch;
    if (!config.dryRun) message.compareUrl = `https://github.com/${config.githubRepo}/compare/main...${branch}?expand=1`;
  }
  return result;
}

function groupMoved(states: NameState[]): Group[] {
  const groups = new Map<string, Group>();
  for (const s of states) {
    if (s.kind !== "moved") continue;
    const key = `${s.file}\0${s.now}`;
    const group = groups.get(key) ?? { file: s.file, names: [], id: s.now };
    group.names.push(s.name);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function restrictTo(evaluations: LoadedEvaluation[], only: string[] | undefined): LoadedEvaluation[] {
  if (only === undefined) return evaluations;
  return evaluations
    .map((item) => ({ ...item, evaluation: { ...item.evaluation, names: (item.evaluation.names ?? []).filter((n) => only.includes(n)) } }))
    .filter((item) => item.evaluation.names.length > 0);
}

function summaryName(name: string, before: number, after: number): string {
  return `${name} (Level ${after}, ${after === before ? "unchanged" : `was ${before}`})`;
}

function lock(stateDir: string): (() => void) | null {
  mkdirSync(stateDir, { recursive: true });
  const file = path.join(stateDir, "run.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, "wx");
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      return () => rmSync(file, { force: true });
    } catch {
      let pid = 0;
      try {
        pid = Number(readFileSync(file, "utf8"));
      } catch {
        // the other run just finished
      }
      let alive = false;
      try {
        process.kill(pid, 0);
        alive = pid > 0;
      } catch {
        alive = false;
      }
      if (alive) return null;
      rmSync(file, { force: true });
    }
  }
  return null;
}

async function execute(config: Config, state: State, say: (message: string) => Promise<boolean>, secrets: string[]): Promise<void> {
  const persist = () => {
    if (!config.dryRun) saveState(config.stateDir, state);
  };
  await pruneJobs(config);
  await syncClone(config);

  if (state.pendingPublish && !config.dryRun) {
    try {
      const sha7 = (await headSha(config)).slice(0, 7);
      const published = await publish(config, [], sha7, new Date().toISOString().slice(0, 10));
      state.pendingPublish = false;
      log(`published the earlier judgements: ${published.cid}`);
      persist();
    } catch (e) {
      log(`publishing again failed: ${clip((e as Error).message)}`);
    }
  }

  const loaded = loadProvider(path.join(config.repoDir, "provider"));
  if (loaded.issues.length > 0) throw new Error(`the provider does not pass check: ${loaded.issues.slice(0, 3).map(formatIssue).join("; ")}`);
  const states = await checkNames(restrictTo(loaded.evaluations, config.only), gatewayResolver(config.resolver));
  const unresolved = states.filter((s) => s.kind === "unresolved").length;
  const groups = groupMoved(states);
  log(`${states.length} names watched: ${groups.reduce((n, g) => n + g.names.length, 0)} moved, ${unresolved} unresolved`);

  const due = groups.filter((g) => !g.names.every((n) => shouldSkip(state, n, g.id, config.maxAttempts))).slice(0, config.maxSitesPerRun);
  const applied: Extract<Result, { kind: "done" }>[] = [];
  const startedAt = new Date();

  for (const group of due) {
    const now = new Date();
    const names = group.names.join(", ");
    const stamp = now.toISOString();
    let result: Result | undefined;
    let reason = "";
    try {
      result = await judgeGroup(config, group, secrets, now);
    } catch (e) {
      reason = withoutSecrets(e instanceof JobFailure ? e.message : `unexpected error: ${clip((e as Error).message)}`, secrets);
      if (config.dryRun) await resetToOrigin(config).catch(() => {});
    }
    if (result?.kind === "rejected") reason = result.reason;
    if (result?.kind === "done") {
      for (const name of group.names) recordDone(state, name, group.id, result.message.action === "apply" ? "applied" : "held", stamp, result.branch);
      persist();
      if (result.message.action === "apply") applied.push(result);
      else {
        const sent = await say(formatJudged(result.message));
        log(`${names}: held for review${sent ? "" : " (message not sent)"}`);
      }
      continue;
    }
    let notify = false;
    let attempts = 0;
    let givingUp = false;
    for (const name of group.names) {
      const out = recordFailure(state, name, group.id, result ? "rejected" : "failed", reason, stamp, config.maxAttempts);
      notify ||= out.notify;
      attempts = out.attempts;
      givingUp ||= out.givingUp;
    }
    persist();
    log(`${names}: ${result ? "not judged" : "failed"}: ${clip(reason)}`);
    if (notify && (await say(formatFailure({ name: names, cid: group.id.slice(4), reason, attempts, givingUp, dryRun: config.dryRun })))) {
      group.names.forEach((n) => markNotified(state, n));
      persist();
    }
  }

  let publishedCid: string | undefined;
  if (applied.length > 0 && !config.dryRun) {
    try {
      const sha7 = (await headSha(config)).slice(0, 7);
      const list = applied.flatMap((r) => [summaryName(r.group.names.join(", "), r.levelBefore, r.levelAfter)]);
      const published = await publish(config, list, sha7, startedAt.toISOString().slice(0, 10));
      publishedCid = published.cid;
      state.pendingPublish = false;
    } catch (e) {
      state.pendingPublish = true;
      log(`publishing failed: ${clip((e as Error).message)}`);
      await say(formatPublishFailure(withoutSecrets(clip((e as Error).message, 300), secrets)));
    }
    persist();
  }
  for (const r of applied) {
    if (publishedCid !== undefined) r.message.publishedCid = publishedCid;
    await say(formatJudged(r.message));
  }
  if (config.dryRun) await resetToOrigin(config).catch(() => {});
}

export async function main(env: Record<string, string | undefined> = process.env): Promise<number> {
  const config = loadConfig(env);
  const secrets = secretsOf(config);
  const sender =
    config.telegramBotToken !== undefined && config.telegramChatId !== undefined
      ? telegramSender(config.telegramBotToken, config.telegramChatId, log)
      : null;
  const say = async (message: string): Promise<boolean> => {
    if (!sender) {
      log("telegram is not configured: a message was not sent");
      return false;
    }
    return sender.send(findSecrets(message, secrets) ? "A message was withheld because it held something shaped like a secret." : message);
  };
  const unlock = lock(config.stateDir);
  if (!unlock) {
    log("another run is in progress");
    return 0;
  }
  const state = loadState(config.stateDir);
  try {
    log(`run starts${config.dryRun ? " (dry run)" : ""}`);
    await execute(config, state, say, secrets);
    log("run finished");
    return 0;
  } catch (e) {
    const message = withoutSecrets(clip(e instanceof Error ? e.message : String(e), 300), secrets);
    log(`run crashed: ${message}`);
    const now = new Date();
    if (runErrorDue(state, now)) {
      if (await say(formatRunError(message))) state.lastRunError = { at: now.toISOString(), message };
    }
    if (!config.dryRun) saveState(config.stateDir, state);
    return 1;
  } finally {
    unlock();
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = await main();
}
