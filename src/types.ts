export type Subject = "website" | "operation" | "connection";

export const SUBJECTS: readonly Subject[] = ["website", "operation", "connection"];

export const STANDARD = "orivon-web3-score/1";

export interface Trustlessity {
  level: number;
  privacy: boolean;
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
}

/** One evaluation file under scores/: `ids` replaces `id`, `subject` repeats the directory. */
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
