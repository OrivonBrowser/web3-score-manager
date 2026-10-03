import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { SUBJECTS } from "./types.ts";
import type { Issue, ProviderDescriptor, SourceEvaluation, Subject } from "./types.ts";
import { SLUG, findDuplicateIds, validateProvider, validateSource } from "./validate.ts";

export interface LoadedEvaluation {
  /** Path shown in messages: the provider directory joined with the relative path. */
  file: string;
  subject: Subject;
  slug: string;
  evaluation: SourceEvaluation;
}

export interface ScannedFile {
  subject: string;
  slug: string;
  abs: string;
  rel: string;
}

function names(dir: string): string[] {
  return readdirSync(dir).filter((n) => !n.startsWith(".")).sort();
}

export function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Every .json file under scores/<subject>/, valid or not, plus stray entries as issues. */
export function scanScores(dir: string): { files: ScannedFile[]; issues: Issue[] } {
  const files: ScannedFile[] = [];
  const issues: Issue[] = [];
  const root = path.join(dir, "scores");
  if (!isDirectory(root)) return { files, issues: [{ file: root, path: "(dir)", message: "scores directory is missing" }] };
  for (const subject of names(root)) {
    const sub = path.join(root, subject);
    if (!SUBJECTS.includes(subject as Subject) || !isDirectory(sub)) {
      issues.push({ file: sub, path: "(entry)", message: `expected only the directories ${SUBJECTS.join(", ")} here` });
      continue;
    }
    for (const n of names(sub)) {
      const abs = path.join(sub, n);
      const slug = n.endsWith(".json") ? n.slice(0, -5) : "";
      if (!SLUG.test(slug) || isDirectory(abs)) {
        issues.push({ file: abs, path: "(file name)", message: "expected <slug>.json where slug matches [a-z0-9][a-z0-9-]{0,63}" });
        continue;
      }
      files.push({ subject, slug, abs, rel: path.join("scores", subject, n) });
    }
  }
  return { files, issues };
}

export function readJson(file: string): { value?: unknown; issue?: Issue } {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    return { issue: { file, path: "(file)", message: `cannot read: ${(e as Error).message}` } };
  }
  try {
    return { value: JSON.parse(text) };
  } catch (e) {
    return { issue: { file, path: "(file)", message: `invalid JSON: ${(e as Error).message}` } };
  }
}

export interface LoadedProvider {
  provider?: ProviderDescriptor;
  evaluations: LoadedEvaluation[];
  issues: Issue[];
}

export function loadProvider(dir: string): LoadedProvider {
  const issues: Issue[] = [];
  const providerFile = path.join(dir, "provider.json");
  let provider: ProviderDescriptor | undefined;
  const read = readJson(providerFile);
  if (read.issue) issues.push(read.issue);
  else {
    const checked = validateProvider(read.value, providerFile);
    provider = checked.provider;
    issues.push(...checked.issues);
  }

  const scanned = scanScores(dir);
  issues.push(...scanned.issues);
  const evaluations: LoadedEvaluation[] = [];
  for (const f of scanned.files) {
    const file = path.join(dir, f.rel);
    const got = readJson(file);
    if (got.issue) {
      issues.push(got.issue);
      continue;
    }
    const checked = validateSource(got.value, file, f.subject as Subject);
    issues.push(...checked.issues);
    if (checked.evaluation) evaluations.push({ file, subject: f.subject as Subject, slug: f.slug, evaluation: checked.evaluation });
  }
  issues.push(...findDuplicateIds(evaluations));
  return { provider, evaluations, issues };
}
