import path from "node:path";
import { DEFAULT_RESOLVER } from "../src/moved.ts";

export interface Config {
  repoDir: string;
  stateDir: string;
  jobsDir: string;
  appDir: string;
  judgeUser: string;
  judgeGroup: string;
  srtBin: string;
  claudeBin: string;
  nodeBin: string;
  ipfsBin: string;
  playwrightBrowsersPath: string;
  ipfsApi: string;
  ipfsApiMultiaddr: string;
  githubRepo: string;
  gitRemote: string;
  deployKey: string | undefined;
  gitName: string;
  gitEmail: string;
  telegramBotToken: string | undefined;
  telegramChatId: string | undefined;
  oauthToken: string | undefined;
  resolver: string;
  model: string;
  maxTurns: number;
  judgeTimeoutS: number;
  fetchTimeoutS: number;
  previousFetchTimeoutS: number;
  statTimeoutS: number;
  probeTimeoutS: number;
  siteMaxBytes: number;
  maxSitesPerRun: number;
  maxAttempts: number;
  keepJobs: number;
  publishDir: string;
  cidFile: string;
  ipnsKey: string;
  summaryFile: string;
  dryRun: boolean;
  only: string[] | undefined;
}

type Env = Record<string, string | undefined>;

function text(env: Env, key: string, fallback: string): string {
  const value = env[key];
  return value === undefined || value === "" ? fallback : value;
}

function optional(env: Env, key: string): string | undefined {
  const value = env[key];
  return value === undefined || value === "" ? undefined : value;
}

function integer(env: Env, key: string, fallback: number, min = 1): number {
  const value = env[key];
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new Error(`${key} must be an integer of at least ${min}`);
  return n;
}

/** `http://host:port` as the multiaddr the ipfs program takes for --api. */
export function multiaddrOf(apiUrl: string): string {
  const url = new URL(apiUrl);
  const kind = /^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname) ? "ip4" : "dns4";
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return `/${kind}/${url.hostname}/tcp/${port}`;
}

/** Every setting comes from the environment, read here and nowhere else. */
export function loadConfig(env: Env = process.env): Config {
  const appDir = text(env, "APP_DIR", path.resolve(import.meta.dirname, ".."));
  const stateDir = text(env, "STATE_DIR", "/var/lib/attila-watch");
  const judgeUser = text(env, "JUDGE_USER", "attila-judge");
  const ipfsApi = text(env, "IPFS_API", "http://127.0.0.1:5001");
  const githubRepo = text(env, "GITHUB_REPO", "OrivonBrowser/web3-score-manager");
  const publishDir = text(env, "PUBLISH_DIR", "/home/ubuntu/orivon-apps/web3-score-attila");
  const bin = (name: string) => path.join(appDir, "watch", "node_modules", ".bin", name);
  const only = optional(env, "ATTILA_WATCH_ONLY")
    ?.split(",")
    .map((n) => n.trim())
    .filter((n) => n !== "");
  return {
    repoDir: text(env, "REPO_DIR", "/var/lib/attila-watch/repo"),
    stateDir,
    jobsDir: text(env, "JOBS_DIR", "/var/attila-jobs"),
    appDir,
    judgeUser,
    judgeGroup: text(env, "JUDGE_GROUP", judgeUser),
    srtBin: text(env, "SRT_BIN", bin("srt")),
    claudeBin: text(env, "CLAUDE_BIN", bin("claude")),
    nodeBin: text(env, "NODE_BIN", process.execPath),
    ipfsBin: text(env, "IPFS_BIN", "/usr/local/bin/ipfs"),
    playwrightBrowsersPath: text(env, "PLAYWRIGHT_BROWSERS_PATH", "/opt/attila-watch/browsers"),
    ipfsApi,
    ipfsApiMultiaddr: text(env, "IPFS_API_MULTIADDR", multiaddrOf(ipfsApi)),
    githubRepo,
    gitRemote: text(env, "GIT_REMOTE", `git@github.com:${githubRepo}.git`),
    deployKey: optional(env, "DEPLOY_KEY"),
    gitName: text(env, "GIT_AUTHOR_NAME", "Attila watch"),
    gitEmail: text(env, "GIT_AUTHOR_EMAIL", "attila-watch@orivonstack.com"),
    telegramBotToken: optional(env, "TELEGRAM_BOT_TOKEN"),
    telegramChatId: optional(env, "TELEGRAM_CHAT_ID"),
    oauthToken: optional(env, "CLAUDE_CODE_OAUTH_TOKEN"),
    resolver: text(env, "RESOLVER", DEFAULT_RESOLVER),
    model: text(env, "MODEL", "claude-sonnet-5-5"),
    maxTurns: integer(env, "MAX_TURNS", 80),
    judgeTimeoutS: integer(env, "JUDGE_TIMEOUT_S", 1500),
    fetchTimeoutS: integer(env, "FETCH_TIMEOUT_S", 900),
    previousFetchTimeoutS: integer(env, "PREVIOUS_FETCH_TIMEOUT_S", 180),
    statTimeoutS: integer(env, "STAT_TIMEOUT_S", 120),
    probeTimeoutS: integer(env, "PROBE_TIMEOUT_S", 120),
    siteMaxBytes: integer(env, "SITE_MAX_BYTES", 300 * 1024 * 1024),
    maxSitesPerRun: integer(env, "MAX_SITES_PER_RUN", 4),
    maxAttempts: integer(env, "MAX_ATTEMPTS", 3),
    keepJobs: integer(env, "KEEP_JOBS", 5),
    publishDir,
    cidFile: text(env, "CID_FILE", `${publishDir}.cid`),
    ipnsKey: text(env, "IPNS_KEY", "web3-score"),
    summaryFile: text(env, "SUMMARY_FILE", "/home/ubuntu/orivon-apps/SUMMARY.md"),
    dryRun: env.ATTILA_WATCH_DRY_RUN === "1",
    only: only && only.length > 0 ? only : undefined,
  };
}

/** Values that must never appear in an answer, a log line or a message. */
export function secretsOf(config: Config): string[] {
  return [config.oauthToken, config.telegramBotToken].filter((s): s is string => s !== undefined);
}
