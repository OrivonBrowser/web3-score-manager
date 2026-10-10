import { canonicalise } from "./identifiers.ts";
import { STANDARD, SUBJECTS } from "./types.ts";
import type { Issue, Part, ProviderDescriptor, SourceEvaluation, Subject, Trustlessity } from "./types.ts";

export const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** A lowercase ASCII .eth name: `vitalik.eth`, `app.example.eth`. */
export const ETH_NAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+eth$/;

const SCALE: Record<Subject, { max: number; privacyAt: readonly number[] }> = {
  website: { max: 4, privacyAt: [4] },
  operation: { max: 5, privacyAt: [4, 5] },
  connection: { max: 3, privacyAt: [3] },
};

const EVIDENCE_PROTOCOLS = ["http:", "https:", "ipfs:", "ipns:"];

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class Collector {
  readonly issues: Issue[] = [];
  readonly file: string;
  constructor(file: string) {
    this.file = file;
  }
  add(path: string, message: string): void {
    this.issues.push({ file: this.file, path, message });
  }
  unknownFields(obj: Obj, known: readonly string[], path: string): void {
    for (const key of Object.keys(obj)) {
      if (!known.includes(key)) this.add(path ? `${path}.${key}` : key, "unknown field");
    }
  }
  string(obj: Obj, key: string, path: string, min: number, max: number, required: boolean): string | undefined {
    const value = obj[key];
    const at = path ? `${path}.${key}` : key;
    if (value === undefined) {
      if (required) this.add(at, "required");
      return undefined;
    }
    if (typeof value !== "string") return void this.add(at, "must be a string");
    if (value.length < min || value.length > max) {
      this.add(at, min === max ? `must be ${min} characters` : `must be ${min} to ${max} characters`);
      return undefined;
    }
    return value;
  }
}

function realDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

function trustlessity(c: Collector, value: unknown, subject: Subject, path: string): Trustlessity | undefined {
  if (value === undefined) return void c.add(path, "required");
  if (!isObj(value)) return void c.add(path, "must be an object");
  c.unknownFields(value, ["level", "privacy"], path);
  const scale = SCALE[subject];
  const { level, privacy } = value;
  let ok = true;
  if (typeof level !== "number" || !Number.isInteger(level) || level < 1 || level > scale.max) {
    c.add(`${path}.level`, `must be an integer from 1 to ${scale.max} on the ${subject} scale`);
    ok = false;
  }
  if (privacy !== undefined && typeof privacy !== "boolean") {
    c.add(`${path}.privacy`, "must be true or false");
    ok = false;
  } else if (privacy === true && ok && !scale.privacyAt.includes(level as number)) {
    c.add(`${path}.privacy`, `privacy is allowed only at ${subject} level ${scale.privacyAt.join(" and ")}`);
    ok = false;
  }
  return ok ? { level: level as number, privacy: privacy === true } : undefined;
}

function canonicalId(c: Collector, value: unknown, subject: Subject, path: string): string | undefined {
  if (typeof value !== "string") return void c.add(path, "must be a string");
  const result = canonicalise(value, subject);
  if (!result.ok) return void c.add(path, result.message);
  return result.id;
}

function parts(c: Collector, value: unknown, subject: Subject, path: string): Part[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return void c.add(path, "must be an array");
  if (value.length > 32) c.add(path, "at most 32 parts");
  const out: Part[] = [];
  value.slice(0, 32).forEach((item, i) => {
    const at = `${path}[${i}]`;
    if (!isObj(item)) return void c.add(at, "must be an object");
    c.unknownFields(item, ["name", "trustlessity", "note", "id"], at);
    const name = c.string(item, "name", at, 1, 80, true);
    const level = trustlessity(c, item.trustlessity, subject, `${at}.trustlessity`);
    const note = c.string(item, "note", at, 0, 300, false);
    const id = item.id === undefined ? undefined : canonicalId(c, item.id, subject, `${at}.id`);
    if (name === undefined || level === undefined) return;
    const part: Part = { name, trustlessity: level };
    if (note !== undefined) part.note = note;
    if (id !== undefined) part.id = id;
    out.push(part);
  });
  return out;
}

function ethNames(c: Collector, value: unknown, subject: Subject | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  if (subject !== undefined && subject !== "website") return void c.add("names", "allowed only on a website evaluation");
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) return void c.add("names", "must be an array of 1 to 8 names");
  const out: string[] = [];
  value.forEach((item, i) => {
    if (typeof item !== "string" || item.length > 255 || !ETH_NAME.test(item)) return void c.add(`names[${i}]`, "must be a lowercase .eth name");
    if (out.includes(item)) return void c.add(`names[${i}]`, `${item} is listed twice`);
    out.push(item);
  });
  return out;
}

function evidence(c: Collector, value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return void c.add("evidence", "must be an array");
  if (value.length > 10) c.add("evidence", "at most 10 entries");
  const out: string[] = [];
  value.slice(0, 10).forEach((item, i) => {
    const at = `evidence[${i}]`;
    if (typeof item !== "string") return void c.add(at, "must be a string");
    if (item.length > 2048 || /\s/.test(item)) return void c.add(at, "must be one address of at most 2048 characters");
    let url: URL;
    try {
      url = new URL(item);
    } catch {
      return void c.add(at, "must be an absolute http, https, ipfs or ipns address");
    }
    if (!EVIDENCE_PROTOCOLS.includes(url.protocol) || (url.host === "" && url.pathname.replace(/^\/+/, "") === "")) {
      return void c.add(at, "must be an absolute http, https, ipfs or ipns address");
    }
    out.push(item);
  });
  return out;
}

export function validateProvider(value: unknown, file: string): { provider?: ProviderDescriptor; issues: Issue[] } {
  const c = new Collector(file);
  if (!isObj(value)) {
    c.add("(root)", "must be a JSON object");
    return { issues: c.issues };
  }
  c.unknownFields(value, ["standard", "name", "bucketHexChars", "about"], "");
  if (value.standard !== STANDARD) c.add("standard", `must be exactly "${STANDARD}"`);
  const name = c.string(value, "name", "", 1, 80, true);
  const n = value.bucketHexChars;
  // Orivon refuses wider buckets: most would hold one known site, so a request would name it.
  const nOk = n === 1 || n === 2;
  if (!nOk) c.add("bucketHexChars", "must be 1 or 2");
  const about = c.string(value, "about", "", 1, 2048, false);
  if (about !== undefined && /\s/.test(about)) c.add("about", "must be one address with no whitespace");
  if (c.issues.length > 0 || name === undefined || !nOk) return { issues: c.issues };
  const provider: ProviderDescriptor = { standard: STANDARD, name, bucketHexChars: n };
  if (about !== undefined) provider.about = about;
  return { provider, issues: [] };
}

/** `dirSubject` is the subject directory the file lives in; omit it for a file not yet placed. */
export function validateSource(
  value: unknown,
  file: string,
  dirSubject?: Subject,
): { evaluation?: SourceEvaluation; issues: Issue[] } {
  const c = new Collector(file);
  if (!isObj(value)) {
    c.add("(root)", "must be a JSON object");
    return { issues: c.issues };
  }
  c.unknownFields(
    value,
    ["subject", "ids", "names", "name", "version", "evaluated", "trustlessity", "summary", "operations", "connections", "evidence"],
    "",
  );

  let subject: Subject | undefined;
  if (value.subject === undefined) c.add("subject", "required");
  else if (!SUBJECTS.includes(value.subject as Subject)) c.add("subject", `must be one of ${SUBJECTS.join(", ")}`);
  else if (dirSubject !== undefined && value.subject !== dirSubject) {
    c.add("subject", `is "${String(value.subject)}" but the file is under scores/${dirSubject}/`);
  } else subject = value.subject as Subject;

  const ids: string[] = [];
  if (value.ids === undefined) c.add("ids", "required");
  else if (!Array.isArray(value.ids)) c.add("ids", "must be an array");
  else {
    if (value.ids.length < 1 || value.ids.length > 8) c.add("ids", "must hold 1 to 8 identifiers");
    const seen = new Set<string>();
    value.ids.slice(0, 8).forEach((raw, i) => {
      const id = subject ? canonicalId(c, raw, subject, `ids[${i}]`) : undefined;
      if (id === undefined) return;
      if (seen.has(id)) return void c.add(`ids[${i}]`, `${id} is listed twice`);
      seen.add(id);
      ids.push(id);
    });
  }

  const watched = ethNames(c, value.names, subject);
  const name = c.string(value, "name", "", 1, 80, true);
  const version = c.string(value, "version", "", 0, 40, false);
  const evaluated = c.string(value, "evaluated", "", 1, 10, true);
  if (evaluated !== undefined && !realDate(evaluated)) c.add("evaluated", "must be a real date, YYYY-MM-DD");
  const level = subject ? trustlessity(c, value.trustlessity, subject, "trustlessity") : undefined;
  const summary = c.string(value, "summary", "", 0, 600, false);

  let operations: Part[] | undefined;
  let connections: Part[] | undefined;
  if (value.operations !== undefined || value.connections !== undefined) {
    if (subject !== undefined && subject !== "website") {
      c.add(value.operations !== undefined ? "operations" : "connections", "allowed only on a website evaluation");
    } else {
      operations = parts(c, value.operations, "operation", "operations");
      connections = parts(c, value.connections, "connection", "connections");
    }
  }
  const links = evidence(c, value.evidence);

  if (c.issues.length > 0 || !subject || !name || !evaluated || !level) return { issues: c.issues };
  const evaluation: SourceEvaluation = { subject, ids, name, evaluated, trustlessity: level };
  if (watched !== undefined) evaluation.names = watched;
  if (version !== undefined) evaluation.version = version;
  if (summary !== undefined) evaluation.summary = summary;
  if (operations !== undefined) evaluation.operations = operations;
  if (connections !== undefined) evaluation.connections = connections;
  if (links !== undefined) evaluation.evidence = links;
  return { evaluation, issues: [] };
}

/** An identifier or a name listed by two evaluations is an error, reported on the later file. */
export function findDuplicateIds(list: { file: string; evaluation: SourceEvaluation }[]): Issue[] {
  const issues: Issue[] = [];
  for (const key of ["ids", "names"] as const) {
    const owner = new Map<string, string>();
    for (const { file, evaluation } of list) {
      (evaluation[key] ?? []).forEach((value, i) => {
        const first = owner.get(value);
        if (first !== undefined && first !== file) {
          issues.push({ file, path: `${key}[${i}]`, message: `${value} is already listed by ${first}` });
        } else owner.set(value, file);
      });
    }
  }
  return issues;
}
