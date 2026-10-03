import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { canonicalise } from "./identifiers.ts";
import { loadProvider, readJson, scanScores } from "./source.ts";
import { SUBJECTS, UserError, formatIssue } from "./types.ts";
import type { Subject } from "./types.ts";
import { SLUG, validateProvider, validateSource } from "./validate.ts";

const BUNDLE_HASH = /^sha256:[0-9a-f]{64}$/;

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function asSubject(value: string): Subject {
  if (!SUBJECTS.includes(value as Subject)) throw new UserError(`subject must be one of ${SUBJECTS.join(", ")}`);
  return value as Subject;
}

function checkSlug(slug: string): void {
  if (!SLUG.test(slug)) throw new UserError(`slug "${slug}" must match [a-z0-9][a-z0-9-]{0,63}`);
}

export function initProvider(dir: string, opts: { name: string; bucketHexChars: number; about?: string }): string {
  const file = path.join(dir, "provider.json");
  if (existsSync(file)) throw new UserError(`${file} already exists`);
  const value: Record<string, unknown> = { standard: "orivon-web3-score/1", name: opts.name, bucketHexChars: opts.bucketHexChars };
  if (opts.about !== undefined) value.about = opts.about;
  const checked = validateProvider(value, file);
  if (checked.issues.length > 0) throw new UserError(checked.issues.map(formatIssue).join("\n"));
  writeJson(file, value);
  mkdirSync(path.join(dir, "scores"), { recursive: true });
  return file;
}

const PLACEHOLDER_ID: Record<Subject, string> = {
  website: "sha256:<64 hex characters>",
  operation: "caip10:<chain namespace>:<chain id>:<account>",
  connection: "caip2:<chain namespace>:<chain id>",
};

export function newEvaluation(dir: string, subjectArg: string, slug: string, ids: string[]): string {
  const subject = asSubject(subjectArg);
  checkSlug(slug);
  const file = path.join(dir, "scores", subject, `${slug}.json`);
  if (existsSync(file)) throw new UserError(`${file} already exists`);
  const canonical = ids.map((raw) => {
    const r = canonicalise(raw, subject);
    if (!r.ok) throw new UserError(`--id ${raw}: ${r.message}`);
    return r.id;
  });
  writeJson(file, {
    subject,
    ids: canonical.length > 0 ? canonical : [PLACEHOLDER_ID[subject]],
    name: "Name of what is evaluated",
    evaluated: today(),
    trustlessity: { level: 1, privacy: false },
  });
  return file;
}

export function addEvaluation(dir: string, source: string, opts: { slug?: string; force: boolean }): string {
  const read = readJson(source);
  if (read.issue) throw new UserError(formatIssue(read.issue));
  const checked = validateSource(read.value, source);
  if (!checked.evaluation) throw new UserError(checked.issues.map(formatIssue).join("\n"));
  const slug = opts.slug ?? path.basename(source).replace(/\.json$/i, "");
  checkSlug(slug);
  const dest = path.join(dir, "scores", checked.evaluation.subject, `${slug}.json`);
  if (existsSync(dest) && !opts.force) throw new UserError(`${dest} already exists (use --force to replace it)`);
  const others = loadProvider(dir).evaluations.filter((x) => path.resolve(x.file) !== path.resolve(dest));
  for (const id of checked.evaluation.ids) {
    const clash = others.find((x) => x.evaluation.ids.includes(id));
    if (clash) throw new UserError(`${id} is already listed by ${clash.file}`);
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(source, dest);
  return dest;
}

function rawIds(file: string): string[] {
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    const ids = (value as { ids?: unknown }).ids;
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function spellings(id: string): Set<string> {
  const out = new Set([id]);
  for (const subject of SUBJECTS) {
    const r = canonicalise(id, subject);
    if (r.ok) out.add(r.id);
  }
  return out;
}

export function removeEvaluation(dir: string, key: string): string {
  const { files } = scanScores(dir);
  const wanted = spellings(key);
  const hits = files.filter((f) => f.slug === key || rawIds(f.abs).some((id) => [...spellings(id)].some((x) => wanted.has(x))));
  if (hits.length === 0) throw new UserError(`no evaluation has the slug or identifier "${key}"`);
  if (hits.length > 1) throw new UserError(`"${key}" is ambiguous; it matches:\n${hits.map((h) => h.abs).join("\n")}`);
  const hit = hits[0]!;
  unlinkSync(hit.abs);
  return hit.abs;
}

export function listEvaluations(dir: string): { lines: string[]; issues: string[] } {
  const loaded = loadProvider(dir);
  const lines = loaded.evaluations.map(({ subject, slug, evaluation: e }) => {
    const lvl = `L${e.trustlessity.level}${e.trustlessity.privacy ? "+privacy" : ""}`;
    return [subject, slug, lvl, e.name, e.ids.join(", ")].join("  ");
  });
  return { lines, issues: loaded.issues.map(formatIssue) };
}

export function readBundleHash(staticDir: string): string {
  const file = path.join(staticDir, ".well-known", "orivon-ddoc.json");
  const read = readJson(file);
  if (read.issue) throw new UserError(formatIssue(read.issue));
  const hash = (read.value as { bundleHash?: unknown } | null)?.bundleHash;
  if (typeof hash !== "string" || !BUNDLE_HASH.test(hash)) {
    throw new UserError(`${file}: bundleHash must match ^sha256:[0-9a-f]{64}$`);
  }
  return hash;
}
