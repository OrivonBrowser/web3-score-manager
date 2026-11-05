export type Subject = "website" | "operation" | "connection" | "integration";

export const SUBJECTS: readonly Subject[] = ["website", "operation", "connection", "integration"];

/** The subjects whose evaluations may carry warnings, a Security level and a mark: the ones that judge content. */
export function judgesContent(subject: Subject): boolean {
  return subject === "website" || subject === "integration";
}

export const STANDARD = "orivon-web3-score/1";

export interface Trustlessity {
  level: number;
  privacy: boolean;
}

export const WARNING_KINDS = ["phishing", "drainer", "malware", "web2", "other"] as const;
export type WarningKind = (typeof WARNING_KINDS)[number];

/** The provider's word that the content is bad. */
export interface Warning {
  kind: WarningKind;
  note?: string;
}

/** The Security level a provider gives content, 1 to 4. */
export interface Security {
  level: number;
  note?: string;
}

export interface Part {
  name: string;
  trustlessity: Trustlessity;
  note?: string;
  id?: string;
}

/** The evaluation object of the standard, as published in a bucket file. */
export interface Evaluation {
  id: string;
  name: string;
  version?: string;
  evaluated: string;
  trustlessity: Trustlessity;
  summary?: string;
  operations?: Part[];
  connections?: Part[];
  evidence?: string[];
  /** The names that serve the judged build (website only); a score counts at these names. */
  names?: string[];
  /** Website and integration only. */
  warnings?: Warning[];
  /** Website and integration only. */
  security?: Security;
  /** Website and integration only: the id of one of the provider's marks in marks.json. */
  mark?: string;
}

/**
 * One evaluation file under scores/: `ids` replaces `id`, `subject` repeats the directory. `names`
 * is published with every entry, and watched by `moved`.
 */
export interface SourceEvaluation extends Omit<Evaluation, "id"> {
  subject: Subject;
  ids: string[];
}

export interface ProviderDescriptor {
  standard: typeof STANDARD;
  name: string;
  bucketHexChars: number;
  about?: string;
}

export interface Issue {
  file: string;
  path: string;
  message: string;
}

export function formatIssue(issue: Issue): string {
  return `${issue.file}: ${issue.path}: ${issue.message}`;
}

export class UserError extends Error {}
