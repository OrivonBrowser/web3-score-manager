import { readFileSync } from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "./fsutil.ts";

export type SiteStatus = "applied" | "held" | "failed" | "rejected";

export interface SiteState {
  cid: string;
  status: SiteStatus;
  attempts: number;
  firstSeen: string;
  lastTry: string;
  lastError?: string;
  branch?: string;
  /** The first-failure message went out; a failed send leaves it false so the next run tries again. */
  notified: boolean;
}

export interface State {
  sites: Record<string, SiteState>;
  pendingPublish?: boolean;
  lastRunError?: { at: string; message: string };
}

const STATUSES: readonly string[] = ["applied", "held", "failed", "rejected"];
const DAY_MS = 24 * 60 * 60 * 1000;

export function emptyState(): State {
  return { sites: {} };
}

/** Reads the state file; a missing or damaged file is an empty state, never a crash. */
export function loadState(stateDir: string): State {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path.join(stateDir, "state.json"), "utf8"));
  } catch {
    return emptyState();
  }
  if (typeof value !== "object" || value === null) return emptyState();
  const raw = value as Record<string, unknown>;
  const state = emptyState();
  if (typeof raw.sites === "object" && raw.sites !== null) {
    for (const [name, site] of Object.entries(raw.sites as Record<string, unknown>)) {
      const s = site as Partial<SiteState> | null;
      if (!s || typeof s.cid !== "string" || !STATUSES.includes(s.status as string)) continue;
      state.sites[name] = {
        cid: s.cid,
        status: s.status as SiteStatus,
        attempts: typeof s.attempts === "number" ? s.attempts : 0,
        firstSeen: typeof s.firstSeen === "string" ? s.firstSeen : "",
        lastTry: typeof s.lastTry === "string" ? s.lastTry : "",
        notified: s.notified === true,
        ...(typeof s.lastError === "string" ? { lastError: s.lastError } : {}),
        ...(typeof s.branch === "string" ? { branch: s.branch } : {}),
      };
    }
  }
  if (raw.pendingPublish === true) state.pendingPublish = true;
  const last = raw.lastRunError as { at?: unknown; message?: unknown } | undefined;
  if (last && typeof last.at === "string" && typeof last.message === "string") state.lastRunError = { at: last.at, message: last.message };
  return state;
}

export function saveState(stateDir: string, state: State): void {
  writeFileAtomic(path.join(stateDir, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
}

/** A held build waits for the owner; a failed or rejected one is retried until it has used its attempts. */
export function shouldSkip(state: State, name: string, cid: string, maxAttempts: number): boolean {
  const entry = state.sites[name];
  if (!entry || entry.cid !== cid) return false;
  if (entry.status === "held") return true;
  return (entry.status === "failed" || entry.status === "rejected") && entry.attempts >= maxAttempts;
}

export interface FailureOutcome {
  attempts: number;
  givingUp: boolean;
  /** A message is due: the first failure of this name and build, and the one that gives up. */
  notify: boolean;
}

/** Records a failed or rejected try; a name whose build changed starts over. */
export function recordFailure(
  state: State,
  name: string,
  cid: string,
  status: "failed" | "rejected",
  reason: string,
  now: string,
  maxAttempts: number,
): FailureOutcome {
  const before = state.sites[name];
  const same = before !== undefined && before.cid === cid;
  const attempts = same ? before.attempts + 1 : 1;
  const givingUp = attempts >= maxAttempts;
  const notify = !(same && before.notified) || givingUp;
  state.sites[name] = {
    cid,
    status,
    attempts,
    firstSeen: same ? before.firstSeen : now,
    lastTry: now,
    lastError: reason,
    notified: same ? before.notified : false,
  };
  return { attempts, givingUp, notify };
}

export function markNotified(state: State, name: string): void {
  const entry = state.sites[name];
  if (entry) entry.notified = true;
}

export function recordDone(state: State, name: string, cid: string, status: "applied" | "held", now: string, branch?: string): void {
  const before = state.sites[name];
  const same = before !== undefined && before.cid === cid;
  state.sites[name] = {
    cid,
    status,
    attempts: (same ? before.attempts : 0) + 1,
    firstSeen: same ? before.firstSeen : now,
    lastTry: now,
    notified: true,
    ...(branch === undefined ? {} : { branch }),
  };
}

/** A crash of the whole run is reported at most once in 24 hours. */
export function runErrorDue(state: State, now: Date): boolean {
  const last = state.lastRunError;
  if (!last) return true;
  const at = Date.parse(last.at);
  return Number.isNaN(at) || now.getTime() - at >= DAY_MS;
}
