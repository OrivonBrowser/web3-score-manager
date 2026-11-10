import {
  DARK_SURFACE,
  LIGHT_SURFACE,
  MAX_ICON_PATH,
  MAX_LABEL,
  MAX_NOTE,
  MIN_CONTRAST,
  PLATE_TINTS,
  colourOf,
  iconPathOf,
  isMarkId,
  isReadable,
  markLabel,
  plainText,
  plateContrast,
} from "./mark-values.ts";
import { reservedWordsIn } from "./reserved-words.ts";
import { STANDARD } from "./types.ts";
import type { Issue } from "./types.ts";

export const MARKS_SUBJECT = "marks";
export const MARKS_FILE = "marks.json";
/** The most marks one file may hold; Orivon uses no mark of a file that lists more. */
export const MAX_MARKS = 16;

export const GRADED = ["web2", "web25", "web3"] as const;
export type Graded = (typeof GRADED)[number];

/** The one reserved word a restyle's label may hold: its own grade's. Whatever else the label says is the provider's. */
const OWN_WORD: Record<Graded, string> = { web2: "web2", web25: "web25", web3: "web3" };

export interface Mark {
  id: string;
  label: string;
  /** `#rrggbb` in lower case: the dot, and the plate at a 13% tint (22% under the pointer on the address bar's button). */
  tone: string;
  ink: { light: string; dark: string };
  icon?: { path: string };
  note?: string;
  restyles?: Graded;
}

/** The file as it is published: exactly the standard's fields, with every value in the form Orivon writes it back in. */
export interface MarksFile {
  standard: typeof STANDARD;
  subject: typeof MARKS_SUBJECT;
  updated: string;
  marks: Mark[];
}

type Obj = Record<string, unknown>;

const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);

function realDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

const isGraded = (value: unknown): value is Graded => (GRADED as readonly unknown[]).includes(value);

/**
 * Checks a marks.json source file by the rules Orivon reads it with (docs/architecture/web3-score-provider.md section
 * `P/marks.json`), and returns it in the form Orivon writes values back in. Orivon ignores a field it does not know; a
 * source file is stricter and refuses one, which catches a misspelt `restyles`. Ink that does not read on its plate leaves a
 * mark in Orivon's file and never drawn, so here it is an error.
 */
export function validateMarks(value: unknown, file: string): { marks?: MarksFile; issues: Issue[] } {
  const issues: Issue[] = [];
  const add = (path: string, message: string): void => void issues.push({ file, path, message });
  if (!isObj(value)) return { issues: [{ file, path: "(root)", message: "must be a JSON object" }] };
  for (const key of Object.keys(value)) {
    if (!["standard", "subject", "updated", "marks"].includes(key)) add(key, "unknown field");
  }
  if (value.standard !== STANDARD) add("standard", `must be exactly "${STANDARD}"`);
  if (value.subject !== MARKS_SUBJECT) add("subject", `must be exactly "${MARKS_SUBJECT}"`);
  const updated = value.updated;
  if (typeof updated !== "string" || !realDate(updated)) add("updated", "required: the day the file last changed, a real date YYYY-MM-DD");

  const out: Mark[] = [];
  if (!Array.isArray(value.marks)) add("marks", "required: a list of marks");
  else {
    if (value.marks.length > MAX_MARKS) add("marks", `at most ${MAX_MARKS} marks; Orivon uses none of a file that lists more`);
    value.marks.slice(0, MAX_MARKS).forEach((item, i) => {
      const mark = readMark(item, `marks[${i}]`, add);
      if (mark === undefined) return;
      if (out.some((held) => held.id === mark.id)) return void add(`marks[${i}].id`, `${mark.id} is listed twice`);
      if (mark.restyles !== undefined && out.some((held) => held.restyles === mark.restyles)) {
        return void add(`marks[${i}].restyles`, `a second mark restyles ${mark.restyles}; at most one does`);
      }
      out.push(mark);
    });
  }
  if (issues.length > 0 || typeof updated !== "string") return { issues };
  return { marks: { standard: STANDARD, subject: MARKS_SUBJECT, updated, marks: out }, issues: [] };
}

function readMark(item: unknown, at: string, add: (path: string, message: string) => void): Mark | undefined {
  if (!isObj(item)) return void add(at, "must be an object");
  let ok = true;
  const fail = (path: string, message: string): void => {
    ok = false;
    add(`${at}.${path}`, message);
  };
  for (const key of Object.keys(item)) {
    if (!["id", "label", "tone", "ink", "icon", "note", "restyles"].includes(key)) fail(key, "unknown field");
  }
  const id = item.id;
  if (!isMarkId(id)) fail("id", "must be a lower-case word: a to z, then a to z, 0 to 9 and -, at most 24 characters");

  const restyles = item.restyles;
  if (restyles !== undefined && !isGraded(restyles)) fail("restyles", "must be web2, web25 or web3");
  const own = isGraded(restyles) ? OWN_WORD[restyles] : undefined;

  const label = markLabel(item.label);
  if (label === undefined) {
    fail("label", `must be 1 to ${MAX_LABEL} plain characters: no control, bidirectional or zero-width character, no space at either end, no run of three combining marks, and no mix of Latin, Cyrillic and Greek letters`);
  } else {
    const words = reservedWordsIn(label).filter((word) => word !== own);
    if (words.length > 0) {
      fail("label", `is, or contains, a word Orivon draws itself (${words.join(", ")}); only a mark that restyles a graded mark may hold that mark's own word`);
    }
  }

  const tone = colourOf(item.tone);
  if (tone === undefined) fail("tone", "must be #rrggbb");

  let ink: Mark["ink"] | undefined;
  if (!isObj(item.ink)) fail("ink", "must be an object with light and dark, each #rrggbb");
  else {
    for (const key of Object.keys(item.ink)) if (key !== "light" && key !== "dark") fail(`ink.${key}`, "unknown field");
    const light = colourOf(item.ink.light);
    const dark = colourOf(item.ink.dark);
    if (light === undefined) fail("ink.light", "must be #rrggbb");
    if (dark === undefined) fail("ink.dark", "must be #rrggbb");
    if (light !== undefined && dark !== undefined) ink = { light, dark };
  }
  if (tone !== undefined && ink !== undefined && !isReadable(tone, ink)) {
    for (const [theme, surface] of [["light", LIGHT_SURFACE], ["dark", DARK_SURFACE]] as const) {
      const ratio = Math.min(...PLATE_TINTS.map((tint) => plateContrast(tone, ink[theme], surface, tint)));
      if (ratio < MIN_CONTRAST) {
        fail(`ink.${theme}`, `reaches ${ratio.toFixed(2)}:1 on the plate in the ${theme} theme, at rest or under the pointer; it needs ${MIN_CONTRAST}:1 or Orivon never draws the mark`);
      }
    }
  }

  let icon: Mark["icon"];
  if (item.icon !== undefined) {
    if (!isObj(item.icon)) fail("icon", "must be an object: { path }");
    else {
      for (const key of Object.keys(item.icon)) if (key !== "path") fail(`icon.${key}`, "unknown field");
      const path = iconPathOf(item.icon.path);
      if (path === undefined) fail("icon.path", `must be one SVG path for a 24 by 24 view box, in the commands M L H V C S Q T A Z with plain decimal numbers none past 100, and at most ${MAX_ICON_PATH} characters as written back (one space between values, one command to each group of them)`);
      else icon = { path };
    }
  }

  let note: string | undefined;
  if (item.note !== undefined) {
    note = plainText(item.note, 0, MAX_NOTE);
    if (note === undefined) fail("note", `must be at most ${MAX_NOTE} plain characters`);
  }

  if (!ok || !isMarkId(id) || label === undefined || tone === undefined || ink === undefined) return undefined;
  const mark: Mark = { id, label, tone, ink };
  if (icon !== undefined) mark.icon = icon;
  if (note !== undefined && note !== "") mark.note = note;
  if (isGraded(restyles)) mark.restyles = restyles;
  return mark;
}
