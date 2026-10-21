import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { readRegularFile, writeFileAtomic } from "./fsutil.ts";

export const MAX_FILES = 50_000;
const MAX_HASHED_BYTES = 64 * 1024 * 1024;
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const MAX_HTML_FILES = 50;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_LIST_LINES = 200;
const TEXT_EXTENSIONS = new Set([".html", ".htm", ".js", ".mjs", ".cjs", ".css", ".json", ".webmanifest", ".svg", ".xml", ".txt"]);

export interface ManifestEntry {
  path: string;
  size: number;
  /** null for a file too large to hash. */
  sha256: string | null;
}

export interface Manifest {
  files: ManifestEntry[];
  truncated: boolean;
}

export interface Diff {
  added: string[];
  removed: string[];
  changed: string[];
}

export interface OriginCount {
  origin: string;
  files: number;
}

export interface HtmlTag {
  file: string;
  tag: "script" | "link" | "iframe";
  url: string;
  integrity: boolean;
}

/** Every regular file below `dir` as a path with "/" separators; symlinks are neither listed nor followed. */
function walk(dir: string, limit = MAX_FILES): { files: string[]; truncated: boolean } {
  const files: string[] = [];
  let truncated = false;
  const visit = (rel: string): void => {
    if (truncated) return;
    let entries;
    try {
      entries = readdirSync(path.join(dir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const child = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) visit(child);
      else if (e.isFile()) {
        if (files.length >= limit) {
          truncated = true;
          return;
        }
        files.push(child);
      }
      if (truncated) return;
    }
  };
  visit("");
  return { files, truncated };
}

export function manifest(dir: string): Manifest {
  const { files, truncated } = walk(dir);
  const entries = files.map((rel): ManifestEntry => {
    const abs = path.join(dir, rel);
    const size = statSync(abs).size;
    if (size > MAX_HASHED_BYTES) return { path: rel, size, sha256: null };
    return { path: rel, size, sha256: createHash("sha256").update(readFileSync(abs)).digest("hex") };
  });
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files: entries, truncated };
}

export function diffManifests(prev: ManifestEntry[], next: ManifestEntry[]): Diff {
  const before = new Map(prev.map((e) => [e.path, e]));
  const after = new Map(next.map((e) => [e.path, e]));
  const added = next.filter((e) => !before.has(e.path)).map((e) => e.path);
  const removed = prev.filter((e) => !after.has(e.path)).map((e) => e.path);
  const changed = next
    .filter((e) => {
      const old = before.get(e.path);
      if (!old) return false;
      return old.sha256 === null || e.sha256 === null ? old.size !== e.size || old.sha256 !== e.sha256 : old.sha256 !== e.sha256;
    })
    .map((e) => e.path);
  return { added, removed, changed };
}

const ORIGIN = /\b(?:https?|wss?):\/\/[a-z0-9.-]+(?::\d{1,5})?/gi;

/** The origins the text files name, with the number of files naming each. */
export function externalOrigins(dir: string): OriginCount[] {
  const counts = new Map<string, number>();
  for (const rel of walk(dir).files) {
    if (!TEXT_EXTENSIONS.has(path.extname(rel).toLowerCase())) continue;
    const data = readRegularFile(path.join(dir, rel), MAX_TEXT_BYTES);
    if (!data) continue;
    const seen = new Set<string>();
    for (const m of data.toString("utf8").matchAll(ORIGIN)) {
      const origin = m[0].toLowerCase().replace(/[.-]+$/, "");
      if (origin === "http://www.w3.org") continue;
      seen.add(origin);
    }
    for (const origin of seen) counts.set(origin, (counts.get(origin) ?? 0) + 1);
  }
  return [...counts].map(([origin, files]) => ({ origin, files })).sort((a, b) => (a.origin < b.origin ? -1 : 1));
}

const ATTRIBUTE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function attributes(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  const inner = tag.replace(/^<[a-zA-Z0-9]+/, "").replace(/\/?>$/, "");
  for (const m of inner.matchAll(ATTRIBUTE)) {
    const name = m[1]!.toLowerCase();
    if (!out.has(name)) out.set(name, m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

/** Absolute to another origin (any scheme with //) or protocol-relative. */
function isExternal(url: string): boolean {
  return /^\/\//.test(url) || /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
}

export function htmlTags(dir: string): HtmlTag[] {
  const out: HtmlTag[] = [];
  let seenFiles = 0;
  for (const rel of walk(dir).files) {
    if (!/\.html?$/i.test(rel)) continue;
    if (seenFiles++ >= MAX_HTML_FILES) break;
    const data = readRegularFile(path.join(dir, rel), MAX_HTML_BYTES);
    if (!data) continue;
    for (const m of data.toString("utf8").matchAll(/<(script|link|iframe)\b[^>]*>/gi)) {
      const tag = m[1]!.toLowerCase() as HtmlTag["tag"];
      const attrs = attributes(m[0]);
      const url = tag === "link" ? attrs.get("href") : attrs.get("src");
      if (url === undefined || !isExternal(url.trim())) continue;
      if (tag === "link" && !/\b(stylesheet|preload|modulepreload)\b/i.test(attrs.get("rel") ?? "")) continue;
      out.push({ file: rel, tag, url: url.trim().slice(0, 300), integrity: attrs.has("integrity") });
    }
  }
  return out;
}

/** What the watch keeps of a build so a later build can be compared with it without fetching it again. */
export interface BuildRecord {
  cid: string;
  manifest: ManifestEntry[];
  origins: OriginCount[];
  savedAt: string;
}

const CID_NAME = /^[a-z0-9]{10,100}$/;

export function loadBuildRecord(stateDir: string, cid: string): BuildRecord | null {
  if (!CID_NAME.test(cid)) return null;
  try {
    const value = JSON.parse(readFileSync(path.join(stateDir, "builds", `${cid}.json`), "utf8")) as Partial<BuildRecord>;
    if (!Array.isArray(value.manifest) || !Array.isArray(value.origins)) return null;
    return value as BuildRecord;
  } catch {
    return null;
  }
}

export function saveBuildRecord(stateDir: string, record: BuildRecord): void {
  if (!CID_NAME.test(record.cid)) throw new Error("not a CID");
  writeFileAtomic(path.join(stateDir, "builds", `${record.cid}.json`), `${JSON.stringify(record)}\n`);
}

export interface Facts {
  cid: string;
  previousCid: string | null;
  comparedAgainst: "the fetched previous build" | "the facts kept from the previous build" | "nothing";
  fileCount: number;
  totalBytes: number;
  truncated: boolean;
  diff: Diff | null;
  origins: (OriginCount & { newSincePrevious: boolean | null })[];
  htmlTags: HtmlTag[];
}

export interface FactsInput {
  cid: string;
  siteDir: string;
  previousCid: string | null;
  /** The fetched previous build, when it could be fetched. */
  previousDir: string | null;
  /** The record kept for the previous CID, used when the build itself is gone. */
  previousRecord: BuildRecord | null;
  savedAt: string;
}

export function buildFacts(input: FactsInput): { facts: Facts; record: BuildRecord } {
  const next = manifest(input.siteDir);
  const origins = externalOrigins(input.siteDir);
  let prevManifest: ManifestEntry[] | null = null;
  let prevOrigins: OriginCount[] | null = null;
  let comparedAgainst: Facts["comparedAgainst"] = "nothing";
  if (input.previousDir !== null) {
    prevManifest = manifest(input.previousDir).files;
    prevOrigins = externalOrigins(input.previousDir);
    comparedAgainst = "the fetched previous build";
  } else if (input.previousRecord !== null) {
    prevManifest = input.previousRecord.manifest;
    prevOrigins = input.previousRecord.origins;
    comparedAgainst = "the facts kept from the previous build";
  }
  const known = prevOrigins === null ? null : new Set(prevOrigins.map((o) => o.origin));
  const facts: Facts = {
    cid: input.cid,
    previousCid: input.previousCid,
    comparedAgainst,
    fileCount: next.files.length,
    totalBytes: next.files.reduce((sum, e) => sum + e.size, 0),
    truncated: next.truncated,
    diff: prevManifest === null ? null : diffManifests(prevManifest, next.files),
    origins: origins.map((o) => ({ ...o, newSincePrevious: known === null ? null : !known.has(o.origin) })),
    htmlTags: htmlTags(input.siteDir),
  };
  const record: BuildRecord = { cid: input.cid, manifest: next.files, origins, savedAt: input.savedAt };
  return { facts, record };
}

function capped(lines: string[]): string[] {
  if (lines.length <= MAX_LIST_LINES) return lines;
  return [...lines.slice(0, MAX_LIST_LINES), `... and ${lines.length - MAX_LIST_LINES} more not listed`];
}

export function renderFactsMd(facts: Facts): string {
  const out: string[] = ["# Facts computed by the watch", "", "Nothing in this file came from the website's own claims.", ""];
  out.push(`New build: ${facts.cid}: ${facts.fileCount} files, ${facts.totalBytes} bytes${facts.truncated ? " (the file list was cut at the cap)" : ""}.`);
  out.push(
    facts.comparedAgainst === "nothing"
      ? "Compared against: nothing. The previous build could not be fetched and no facts were kept for it."
      : `Compared against: ${facts.comparedAgainst}${facts.previousCid ? ` (${facts.previousCid})` : ""}.`,
  );
  out.push("");
  if (facts.diff) {
    for (const [title, list] of [
      ["Files added", facts.diff.added],
      ["Files removed", facts.diff.removed],
      ["Files changed", facts.diff.changed],
    ] as const) {
      out.push(`## ${title} (${list.length})`, ...capped(list.map((p) => `- ${p}`)), "");
    }
  } else out.push("## File changes", "Not known: there was nothing to compare against.", "");
  const newOnes = facts.origins.filter((o) => o.newSincePrevious === true);
  if (facts.origins.length > 0 && facts.origins.every((o) => o.newSincePrevious === null)) {
    out.push(`## Origins named in the files (${facts.origins.length})`);
  } else out.push(`## Origins the new build names that the previous one did not (${newOnes.length})`);
  const shown = facts.origins.every((o) => o.newSincePrevious === null) ? facts.origins : newOnes;
  out.push(...capped(shown.map((o) => `- ${o.origin} (${o.files} file${o.files === 1 ? "" : "s"})`)), "");
  const rest = facts.origins.filter((o) => o.newSincePrevious === false);
  if (rest.length > 0) out.push(`## Origins named by both builds (${rest.length})`, ...capped(rest.map((o) => `- ${o.origin} (${o.files})`)), "");
  out.push(`## Script, stylesheet and frame tags that point to another origin (${facts.htmlTags.length})`);
  out.push(...capped(facts.htmlTags.map((t) => `- ${t.file}: <${t.tag}> ${t.url} (${t.integrity ? "with" : "no"} integrity)`)), "");
  return `${out.join("\n")}\n`;
}
