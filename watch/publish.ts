import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { CID } from "multiformats/cid";
import type { Config } from "./config.ts";
import { writeFileAtomic } from "./fsutil.ts";
import { cliArgs } from "./git.ts";
import { failed, run } from "./proc.ts";

const SECTION = "## Web3 Score provider: Orivon Attila";

/**
 * Inside the Attila section the old CID becomes the new one wherever it appears; one log line is
 * appended at the end of the file, where the log section is.
 */
export function updateSummary(text: string, oldCid: string, newCid: string, logLine: string): string {
  let out = text;
  const start = out.indexOf(SECTION);
  if (start !== -1 && oldCid !== "") {
    const next = out.indexOf("\n## ", start + SECTION.length);
    const end = next === -1 ? out.length : next;
    out = out.slice(0, start) + out.slice(start, end).replaceAll(oldCid, newCid) + out.slice(end);
  }
  return `${out}${out.endsWith("\n") || out === "" ? "" : "\n"}${logLine}\n`;
}

export function summaryLine(date: string, judged: string[], sha7: string, cid: string): string {
  const what = judged.length > 0 ? `Attila watch judged ${judged.join(", ")}` : "Attila watch republished Attila";
  return `- ${date}: ${what} (web3-score-manager ${sha7}); \`web3-score\` key moved to ${cid}.`;
}

export interface PublishResult {
  cid: string;
  changed: boolean;
}

function ipfs(config: Config, args: string[], timeoutS: number) {
  return run(config.ipfsBin, ["--api", config.ipfsApiMultiaddr, ...args], {
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/" },
    timeoutMs: timeoutS * 1000,
  });
}

function isPreviousBuild(dir: string): boolean {
  return existsSync(path.join(dir, "score", "provider.json"));
}

/**
 * Builds Attila from the data clone, mirrors it into the publish directory, adds it to IPFS and
 * moves the IPNS name. The CID file and the summary change only after the name has moved, so a
 * failed publish is simply tried again by the next run.
 */
export async function publish(config: Config, judged: string[], sha7: string, today: string): Promise<PublishResult> {
  const dist = path.join(config.stateDir, "dist");
  if (existsSync(dist) && !isPreviousBuild(dist)) rmSync(dist, { recursive: true, force: true });
  const built = await run(config.nodeBin, cliArgs(config, "build", "--out", dist), { cwd: config.repoDir, timeoutMs: 120_000 });
  if (failed(built)) throw new Error(`building Attila failed: ${built.stderr.trim().split("\n")[0] ?? ""}`);

  mkdirSync(config.publishDir, { recursive: true });
  const sync = await run("rsync", ["-a", "--delete", `${dist}/`, `${config.publishDir}/`], { timeoutMs: 120_000 });
  if (failed(sync)) throw new Error(`copying the build failed: ${sync.stderr.trim().split("\n")[0] ?? ""}`);

  const added = await ipfs(config, ["add", "-r", "--cid-version=1", "-Q", config.publishDir], 600);
  if (failed(added)) throw new Error(`ipfs add failed: ${added.stderr.trim().split("\n")[0] ?? ""}`);
  const cid = added.stdout.trim().split("\n").pop() ?? "";
  try {
    CID.parse(cid);
  } catch {
    throw new Error("ipfs add did not print a CID");
  }

  const previous = existsSync(config.cidFile) ? readFileSync(config.cidFile, "utf8").trim() : "";
  if (previous === cid) return { cid, changed: false };

  const named = await ipfs(config, ["name", "publish", `--key=${config.ipnsKey}`, "--timeout=300s", `/ipfs/${cid}`], 330);
  if (failed(named)) throw new Error(`moving the IPNS name failed: ${named.stderr.trim().split("\n")[0] ?? ""}`);

  if (previous !== "") {
    const backup = `${config.cidFile}.bak-${today.replaceAll("-", "")}`;
    if (!existsSync(backup)) copyFileSync(config.cidFile, backup);
  }
  writeFileAtomic(config.cidFile, `${cid}\n`);
  if (existsSync(config.summaryFile)) {
    const text = readFileSync(config.summaryFile, "utf8");
    writeFileAtomic(config.summaryFile, updateSummary(text, previous, cid, summaryLine(today, judged, sha7, cid)));
  }
  return { cid, changed: true };
}
