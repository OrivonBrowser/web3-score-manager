import type { Stats } from "node:fs";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { bucketOf } from "./bucket.ts";
import { renderIndex, renderScoreIndex } from "./html.ts";
import type { LoadedEvaluation } from "./source.ts";
import { loadProvider } from "./source.ts";
import { STANDARD, SUBJECTS, UserError, formatIssue } from "./types.ts";
import type { Evaluation, Issue, ProviderDescriptor, SourceEvaluation } from "./types.ts";

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function toEntry(id: string, e: SourceEvaluation): Evaluation {
  return {
    id,
    name: e.name,
    ...(e.version !== undefined && { version: e.version }),
    evaluated: e.evaluated,
    trustlessity: { level: e.trustlessity.level, privacy: e.trustlessity.privacy },
    ...(e.summary !== undefined && { summary: e.summary }),
    ...(e.operations !== undefined && { operations: e.operations }),
    ...(e.connections !== undefined && { connections: e.connections }),
    ...(e.evidence !== undefined && { evidence: e.evidence }),
  };
}

/** The whole site as relative POSIX path -> text. Pure and deterministic. */
export function renderSite(provider: ProviderDescriptor, evaluations: LoadedEvaluation[]): Map<string, string> {
  const files = new Map<string, string>();
  const descriptor: ProviderDescriptor = { standard: provider.standard, name: provider.name, bucketHexChars: provider.bucketHexChars };
  if (provider.about !== undefined) descriptor.about = provider.about;
  files.set("score/provider.json", json(descriptor));

  for (const subject of SUBJECTS) {
    const buckets = new Map<string, Evaluation[]>();
    for (const item of evaluations) {
      if (item.subject !== subject) continue;
      for (const id of item.evaluation.ids) {
        const bucket = bucketOf(id, provider.bucketHexChars);
        const list = buckets.get(bucket) ?? [];
        list.push(toEntry(id, item.evaluation));
        buckets.set(bucket, list);
      }
    }
    for (const [bucket, entries] of buckets) {
      entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      files.set(`score/${subject}/${bucket}.json`, json({ standard: STANDARD, subject, bucket, entries }));
    }
  }
  files.set("index.html", renderIndex(provider, evaluations));
  files.set("score/index.html", renderScoreIndex(provider));
  return files;
}

/** Loads and validates a provider directory; throws a UserError listing every problem. */
export function compileProvider(dir: string): Map<string, string> {
  const loaded = loadProvider(dir);
  if (loaded.issues.length > 0 || !loaded.provider) throw new ValidationFailure(loaded.issues);
  return renderSite(loaded.provider, loaded.evaluations);
}

export class ValidationFailure extends UserError {
  readonly issues: Issue[];
  constructor(issues: Issue[]) {
    super(`${issues.length} problem${issues.length === 1 ? "" : "s"}:\n${issues.map(formatIssue).join("\n")}`);
    this.issues = issues;
  }
}

function within(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function statOrUndefined(p: string): Stats | undefined {
  try {
    return statSync(p);
  } catch {
    return undefined;
  }
}

/** Replaces `out` only when it is empty or a previous build, and never when it holds the source. */
export function writeSite(out: string, files: Map<string, string>, sourceDir?: string): void {
  const target = path.resolve(out);
  const existing = statOrUndefined(target);
  if (existing) {
    if (!existing.isDirectory()) throw new UserError(`${out} exists and is not a directory`);
    const empty = readdirSync(target).length === 0;
    const previous = statOrUndefined(path.join(target, "score", "provider.json"))?.isFile() === true;
    if (!empty && !previous) {
      throw new UserError(`${out} is not empty and is not a previous build (no score/provider.json); refusing to delete it`);
    }
    if (sourceDir !== undefined && within(target, path.resolve(sourceDir))) {
      throw new UserError(`${out} contains the provider directory; choose another --out`);
    }
    rmSync(target, { recursive: true, force: true });
  }
  for (const [rel, text] of files) {
    const dest = path.join(target, ...rel.split("/"));
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, text, "utf8");
  }
}
