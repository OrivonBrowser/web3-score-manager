export interface VerdictPart {
  name: string;
  level: number;
  privacy?: boolean;
  note?: string;
}

/** The judge's answer, as judge/schema.json describes it. */
export interface Verdict {
  renders: boolean;
  sameAsBefore: boolean;
  injectionSuspected: boolean;
  name: string;
  version?: string;
  level: number;
  privacy: boolean;
  summary: string;
  operations: VerdictPart[];
  connections: VerdictPart[];
  evidence: string[];
  changes: string;
  concerns: string;
}

const TOP_KEYS = [
  "renders",
  "sameAsBefore",
  "injectionSuspected",
  "name",
  "version",
  "level",
  "privacy",
  "summary",
  "operations",
  "connections",
  "evidence",
  "changes",
  "concerns",
];
const REQUIRED = TOP_KEYS.filter((k) => k !== "version");
const PART_KEYS = ["name", "level", "privacy", "note"];
const EVIDENCE_PROTOCOLS = ["http:", "https:", "ipfs:", "ipns:"];

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function str(obj: Obj, key: string, at: string, min: number, max: number, issues: string[]): string | undefined {
  const v = obj[key];
  if (typeof v !== "string") {
    issues.push(`${at}${key}: must be a string`);
    return undefined;
  }
  if (v.length < min || v.length > max) {
    issues.push(`${at}${key}: must be ${min} to ${max} characters`);
    return undefined;
  }
  return v;
}

function bool(obj: Obj, key: string, at: string, issues: string[]): boolean | undefined {
  if (typeof obj[key] !== "boolean") {
    issues.push(`${at}${key}: must be true or false`);
    return undefined;
  }
  return obj[key] as boolean;
}

function int(obj: Obj, key: string, at: string, min: number, max: number, issues: string[]): number | undefined {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    issues.push(`${at}${key}: must be an integer from ${min} to ${max}`);
    return undefined;
  }
  return v;
}

function parts(value: unknown, key: string, max: number, privacyAt: number[], issues: string[]): VerdictPart[] {
  if (!Array.isArray(value)) {
    issues.push(`${key}: must be an array`);
    return [];
  }
  if (value.length > 32) issues.push(`${key}: at most 32 entries`);
  const out: VerdictPart[] = [];
  value.slice(0, 32).forEach((item, i) => {
    const at = `${key}[${i}].`;
    if (!isObj(item)) return void issues.push(`${key}[${i}]: must be an object`);
    for (const k of Object.keys(item)) if (!PART_KEYS.includes(k)) issues.push(`${at}${k}: unknown field`);
    if (item.privacy !== undefined && typeof item.privacy !== "boolean") issues.push(`${at}privacy: must be true or false`);
    if (item.note !== undefined) str(item, "note", at, 0, 300, issues);
    const name = str(item, "name", at, 1, 80, issues);
    const level = int(item, "level", at, 1, max, issues);
    if (item.privacy === true && level !== undefined && !privacyAt.includes(level)) {
      issues.push(`${at}privacy: allowed only at level ${privacyAt.join(" and ")}`);
    }
    if (name === undefined || level === undefined) return;
    const part: VerdictPart = { name, level };
    if (typeof item.privacy === "boolean") part.privacy = item.privacy;
    if (typeof item.note === "string") part.note = item.note;
    out.push(part);
  });
  return out;
}

function evidenceUrls(value: unknown, issues: string[]): string[] {
  if (!Array.isArray(value)) {
    issues.push("evidence: must be an array");
    return [];
  }
  if (value.length > 10) issues.push("evidence: at most 10 entries");
  const out: string[] = [];
  value.slice(0, 10).forEach((item, i) => {
    const at = `evidence[${i}]`;
    if (typeof item !== "string" || item.length < 1 || item.length > 2048 || /\s/.test(item)) {
      return void issues.push(`${at}: must be one address of at most 2048 characters`);
    }
    let url: URL;
    try {
      url = new URL(item);
    } catch {
      return void issues.push(`${at}: must be an absolute http, https, ipfs or ipns address`);
    }
    if (!EVIDENCE_PROTOCOLS.includes(url.protocol) || (url.host === "" && url.pathname.replace(/^\/+/, "") === "")) {
      return void issues.push(`${at}: must be an absolute http, https, ipfs or ipns address`);
    }
    out.push(item);
  });
  return out;
}

/** Mirrors judge/schema.json exactly, then applies the scale rules of src/validate.ts. */
export function validateVerdict(value: unknown): { verdict?: Verdict; issues: string[] } {
  const issues: string[] = [];
  if (!isObj(value)) return { issues: ["(root): must be a JSON object"] };
  for (const k of Object.keys(value)) if (!TOP_KEYS.includes(k)) issues.push(`${k}: unknown field`);
  for (const k of REQUIRED) if (value[k] === undefined) issues.push(`${k}: required`);
  if (issues.length > 0) return { issues };

  const renders = bool(value, "renders", "", issues);
  const sameAsBefore = bool(value, "sameAsBefore", "", issues);
  const injectionSuspected = bool(value, "injectionSuspected", "", issues);
  const name = str(value, "name", "", 1, 80, issues);
  const version = value.version === undefined ? undefined : str(value, "version", "", 0, 40, issues);
  const level = int(value, "level", "", 1, 4, issues);
  const privacy = bool(value, "privacy", "", issues);
  if (privacy === true && level !== undefined && level !== 4) issues.push("privacy: allowed only at website level 4");
  const summary = str(value, "summary", "", 1, 600, issues);
  const operations = parts(value.operations, "operations", 5, [4, 5], issues);
  const connections = parts(value.connections, "connections", 3, [3], issues);
  const evidence = evidenceUrls(value.evidence, issues);
  const changes = str(value, "changes", "", 0, 800, issues);
  const concerns = str(value, "concerns", "", 0, 800, issues);

  if (
    issues.length > 0 ||
    renders === undefined ||
    sameAsBefore === undefined ||
    injectionSuspected === undefined ||
    name === undefined ||
    level === undefined ||
    privacy === undefined ||
    summary === undefined ||
    changes === undefined ||
    concerns === undefined
  ) {
    return { issues };
  }
  const verdict: Verdict = { renders, sameAsBefore, injectionSuspected, name, level, privacy, summary, operations, connections, evidence, changes, concerns };
  if (version !== undefined) verdict.version = version;
  return { verdict, issues: [] };
}

const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{10,}/,
  /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /fake_value_[0-9a-f-]{36}/,
];

/** True when the text holds a known secret or something shaped like one. The match itself is never returned. */
export function findSecrets(text: string, known: readonly string[]): boolean {
  if (known.some((s) => s.length >= 8 && text.includes(s))) return true;
  return SECRET_PATTERNS.some((p) => p.test(text));
}
