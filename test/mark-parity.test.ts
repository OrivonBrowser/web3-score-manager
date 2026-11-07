import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { CONFUSABLES_VERSION } from "../src/confusables.ts";
import {
  DARK_SURFACE,
  LIGHT_SURFACE,
  MAX_ICON_PATH,
  MAX_LABEL,
  MAX_NOTE,
  MIN_CONTRAST,
  PLATE_TINTS,
  iconPathOf,
  isReadable,
  plateContrast,
} from "../src/mark-values.ts";
import { validateMarks } from "../src/marks.ts";
import { COPIES, differingCopies, digestOf } from "../src/orivon-copies.ts";
import { drawsAs, reservedWordsIn } from "../src/reserved-words.ts";

// Attila reads a marks file the way Orivon's reader does, so a file that passes here is a file Orivon uses whole. The cases
// are in one JSON file whose expected values are what Orivon's own functions return (src/trust/mark-values.ts and
// src/trust/reserved-words.ts in the Orivon repository), and which also holds the hash of every file copied from there:
// the copies are held to those hashes on every run, and to the originals themselves when ORIVON_REPO names an Orivon checkout.

interface Fixture {
  surfaces: { light: string; dark: string };
  labels: [string, string[]][];
  contrast: { tone: string; ink: string; theme: "light" | "dark"; tint?: number; ratio: number }[];
  drawsAs: [string, string, boolean][];
  readable: { why: string; tone: string; ink: { light: string; dark: string }; readable: boolean }[];
  icons: { why: string; path: string; written: string | null }[];
  copies: Record<string, string>;
}

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.join(here, "..");
const fixture = JSON.parse(readFileSync(path.join(here, "fixtures", "orivon-reader.json"), "utf8")) as Fixture;

const marksFile = (mark: Record<string, unknown>): unknown => ({ standard: "orivon-web3-score/1", subject: "marks", updated: "2026-11-06", marks: [mark] });
const plain = { id: "audited", label: "Audited", tone: "#2563eb", ink: { light: "#1e3a8a", dark: "#bfdbfe" } };

test("the ink is measured on the surfaces Orivon measures it on", () => {
  assert.equal(LIGHT_SURFACE, fixture.surfaces.light);
  assert.equal(DARK_SURFACE, fixture.surfaces.dark);
  assert.equal(LIGHT_SURFACE, "#e4e4eb");
  assert.equal(DARK_SURFACE, "#35294b");
});

test("the contrast of the fixture's inks is the ratio Orivon measures, at the tint it names", () => {
  assert.ok(fixture.contrast.length > 0);
  assert.ok(fixture.contrast.some(({ tint }) => tint === PLATE_TINTS[1]));
  for (const { tone, ink, theme, tint, ratio } of fixture.contrast) {
    const surface = theme === "light" ? LIGHT_SURFACE : DARK_SURFACE;
    assert.ok(Math.abs(plateContrast(tone, ink, surface, tint) - ratio) < 0.01, `${tone} with ${ink} in ${theme} at ${String(tint)}`);
  }
});

test("ink reads on its plate as Orivon decides, at rest and under the pointer, and a file is refused when it does not", () => {
  assert.ok(fixture.readable.some(({ readable }) => readable) && fixture.readable.some(({ readable }) => !readable));
  for (const { why, tone, ink, readable } of fixture.readable) {
    assert.equal(isReadable(tone, ink), readable, why);
    assert.equal(validateMarks(marksFile({ ...plain, tone, ink }), "marks.json").issues.length === 0, readable, why);
  }
});

test("an ink that reads on white and not on the plate is refused, in either theme", () => {
  const file = (ink: { light: string; dark: string }) => marksFile({ id: "audited", label: "Audited", tone: "#22c55e", ink });
  // 4.84 over white, 3.91 on the plate Orivon measures.
  assert.ok(plateContrast("#22c55e", "#6a6a6a", "#ffffff") >= MIN_CONTRAST);
  assert.ok(plateContrast("#22c55e", "#6a6a6a", LIGHT_SURFACE) < MIN_CONTRAST);
  assert.deepEqual(validateMarks(file({ light: "#6a6a6a", dark: "#ffffff" }), "marks.json").issues.map((i) => i.path), ["marks[0].ink.light"]);
  assert.deepEqual(validateMarks(file({ light: "#000000", dark: "#6a6a6a" }), "marks.json").issues.map((i) => i.path), ["marks[0].ink.dark"]);
  assert.deepEqual(validateMarks(file({ light: "#000000", dark: "#ffffff" }), "marks.json").issues, []);
});

test("a label reads as the reserved words Orivon reads in it, through every lookalike in Unicode's table and every pair that draws as a letter", () => {
  assert.ok(fixture.labels.length > 80);
  for (const label of ["VVeb3", "Vveb3", "\\/\\/eb3", "uueb3", "Waming", "UnprotecteCI"]) assert.ok(fixture.labels.some(([held]) => held === label), label);
  for (const [label, words] of fixture.labels) assert.deepEqual(reservedWordsIn(label), words, JSON.stringify(label));
});

test("a label is the whole of a reserved word as Orivon reads it, and a restyle carrying anything else is refused", () => {
  assert.ok(fixture.drawsAs.length > 20);
  for (const [label, word, whole] of fixture.drawsAs) assert.equal(drawsAs(label, word), whole, `${JSON.stringify(label)} as ${word}`);
  const graded = ["web2", "web25", "web3"];
  for (const [label, word, whole] of fixture.drawsAs) {
    if (!graded.includes(word) || reservedWordsIn(label).some((held) => held !== word)) continue;
    const issues = validateMarks(marksFile({ ...plain, id: "look", label, restyles: word }), "marks.json").issues;
    assert.equal(issues.length === 0, whole, `${JSON.stringify(label)} restyling ${word}`);
  }
});

test("a label whose skeleton is a reserved word, by a character outside a hand list or by a pair that draws as a letter, is refused", () => {
  for (const label of ["սnprotected", "ꓴnprotected", "աeb3", "Web३", "Safeⵑ", "ꓪeb3", "VVeb3", "Vveb3", "\\/\\/eb3", "uueb3", "Waming"]) {
    assert.deepEqual(validateMarks(marksFile({ ...plain, label }), "marks.json").issues.map((i) => i.path), ["marks[0].label"], JSON.stringify(label));
  }
  assert.deepEqual(validateMarks(marksFile(plain), "marks.json").issues, []);
});

test("an icon path is read and written back as Orivon does, and what is written is read again unchanged", () => {
  assert.ok(fixture.icons.some(({ path: given }) => given.length === 1004), "the compact path of 1004 characters");
  for (const { why, path: given, written } of fixture.icons) {
    assert.equal(iconPathOf(given) ?? null, written, why);
    if (written !== null) assert.equal(iconPathOf(written), written, `${why}, read again`);
    const issues = validateMarks(marksFile({ ...plain, icon: { path: given } }), "marks.json").issues;
    assert.deepEqual(issues.map((i) => i.path), written === null ? ["marks[0].icon.path"] : [], why);
  }
});

test("a path read once is read again unchanged, whatever shape it was written in", () => {
  let seed = 7;
  const next = (bound: number): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return Math.floor(seed / 65536) % bound;
  };
  const arity: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
  const commands = Object.keys(arity);
  const blanks = ["", " ", ",", "  ", " , "];
  const number = (): string => `${next(2) === 0 ? "-" : ""}${next(100)}${next(3) === 0 ? `.${next(1000)}` : ""}`;
  // A group's values: an arc has a rotation and two flags, each flag one digit.
  const values = (command: string): string[] =>
    Array.from({ length: arity[command]! }, (_, k) => (command === "A" ? (k === 3 || k === 4 ? String(next(2)) : k === 2 ? String(next(361)) : number()) : number()));
  let accepted = 0;
  let refused = 0;
  for (let n = 0; n < 400; n++) {
    let text = `M${next(30)} ${next(30)}`;
    for (let k = next(300); k > 0; k--) {
      const raw = commands[next(commands.length)]!;
      const command = next(2) === 0 ? raw : raw.toLowerCase();
      const group = values(raw).join(blanks[1 + next(4)]!);
      text += `${blanks[next(blanks.length)]!}${command}${command.toUpperCase() === "Z" ? "" : blanks[next(blanks.length)]!}${group}`;
    }
    const written = iconPathOf(text);
    if (written === undefined) {
      refused++;
      continue;
    }
    accepted++;
    const shown = `${text.length} characters from ${JSON.stringify(text.slice(0, 60))}`;
    assert.ok(written.length <= MAX_ICON_PATH, shown);
    assert.equal(iconPathOf(written), written, shown);
  }
  assert.ok(accepted > 40 && refused > 40, `${accepted} of 400 paths were read and ${refused} refused`);
});

test("the table of lookalikes is Unicode's, at the version and hash this tool was checked against", () => {
  const table = readFileSync(path.join(root, "src", "confusables.json"), "utf8");
  assert.equal(CONFUSABLES_VERSION, "18.0.0");
  assert.equal(digestOf(table), fixture.copies["confusables.json"]);
  assert.ok((JSON.parse(table) as { table: string }).table.split(" ").length > 6000);
});

test("the numbers every mark is bounded by are Orivon's", () => {
  assert.equal(MAX_LABEL, 12);
  assert.equal(MAX_NOTE, 300);
  assert.equal(MAX_ICON_PATH, 1024);
  assert.equal(MIN_CONTRAST, 4.5);
  assert.deepEqual(PLATE_TINTS, [0.13, 0.22]);
});

test("every file copied from Orivon is the text the fixture holds the hash of, and the fixture names no other", () => {
  assert.deepEqual(Object.keys(fixture.copies).sort(), [...COPIES].sort());
  for (const name of COPIES) {
    assert.equal(digestOf(readFileSync(path.join(root, "src", name), "utf8")), fixture.copies[name], `${name} is not the text Orivon's fixture hashes: copy it again from Orivon's src/trust/`);
  }
});

// The copies against the originals, byte for byte but for their import lines. It needs an Orivon checkout, so it runs when
// ORIVON_REPO names one (the path of its root); publishing Attila refuses to run without it (watch/publish.ts).
const orivon = process.env.ORIVON_REPO;
const skip = orivon !== undefined && existsSync(path.join(orivon, "src", "trust", "mark-values.ts")) ? false : "set ORIVON_REPO to an Orivon checkout to compare the copies with it";

test("the copies are Orivon's files, and the fixture holds their hashes", { skip }, () => {
  assert.deepEqual(differingCopies(orivon ?? "", root), []);
  for (const name of COPIES) {
    assert.equal(digestOf(readFileSync(path.join(orivon ?? "", "src", "trust", name), "utf8")), fixture.copies[name], `${name}: the fixture's hash is not Orivon's file`);
  }
});
