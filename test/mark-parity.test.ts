import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { CONFUSABLES_VERSION } from "../src/confusables.ts";
import { DARK_SURFACE, LIGHT_SURFACE, MAX_ICON_PATH, MAX_LABEL, MAX_NOTE, MIN_CONTRAST, plateContrast } from "../src/mark-values.ts";
import { validateMarks } from "../src/marks.ts";
import { reservedWordsIn } from "../src/reserved-words.ts";

// Attila reads a marks file the way Orivon's reader does, so a file that passes here is a file Orivon uses whole. The cases
// are in one JSON file whose expected values are what Orivon's own functions return (src/trust/mark-values.ts and
// src/trust/reserved-words.ts in the Orivon repository). The copied table is held to its hash here, and to the original when
// ORIVON_REPO names an Orivon checkout.

interface Fixture {
  surfaces: { light: string; dark: string };
  labels: [string, string[]][];
  contrast: { tone: string; ink: string; theme: "light" | "dark"; ratio: number }[];
}

const here = path.dirname(new URL(import.meta.url).pathname);
const fixture = JSON.parse(readFileSync(path.join(here, "fixtures", "orivon-reader.json"), "utf8")) as Fixture;

test("the ink is measured on the surfaces Orivon measures it on", () => {
  assert.equal(LIGHT_SURFACE, fixture.surfaces.light);
  assert.equal(DARK_SURFACE, fixture.surfaces.dark);
  assert.equal(LIGHT_SURFACE, "#e4e4eb");
  assert.equal(DARK_SURFACE, "#35294b");
});

test("the contrast of the fixture's inks is the ratio Orivon measures", () => {
  assert.ok(fixture.contrast.length > 0);
  for (const { tone, ink, theme, ratio } of fixture.contrast) {
    const surface = theme === "light" ? LIGHT_SURFACE : DARK_SURFACE;
    assert.ok(Math.abs(plateContrast(tone, ink, surface) - ratio) < 0.01, `${tone} with ${ink} in ${theme}`);
  }
});

test("an ink that reads on white and not on the plate is refused, in either theme", () => {
  const mark = (ink: { light: string; dark: string }) => ({ id: "audited", label: "Audited", tone: "#22c55e", ink });
  const file = (ink: { light: string; dark: string }) => ({ standard: "orivon-web3-score/1", subject: "marks", updated: "2026-11-06", marks: [mark(ink)] });
  // 4.84 over white, 3.91 on the plate Orivon measures.
  assert.ok(plateContrast("#22c55e", "#6a6a6a", "#ffffff") >= MIN_CONTRAST);
  assert.ok(plateContrast("#22c55e", "#6a6a6a", LIGHT_SURFACE) < MIN_CONTRAST);
  assert.deepEqual(validateMarks(file({ light: "#6a6a6a", dark: "#ffffff" }), "marks.json").issues.map((i) => i.path), ["marks[0].ink.light"]);
  assert.deepEqual(validateMarks(file({ light: "#000000", dark: "#6a6a6a" }), "marks.json").issues.map((i) => i.path), ["marks[0].ink.dark"]);
  assert.deepEqual(validateMarks(file({ light: "#000000", dark: "#ffffff" }), "marks.json").issues, []);
});

test("a label reads as the reserved words Orivon reads in it, through every lookalike in Unicode's table", () => {
  assert.ok(fixture.labels.length > 40);
  for (const [label, words] of fixture.labels) assert.deepEqual(reservedWordsIn(label), words, JSON.stringify(label));
});

test("a label whose skeleton is a reserved word only through a character outside a hand list is refused", () => {
  const file = (label: string) => ({ standard: "orivon-web3-score/1", subject: "marks", updated: "2026-11-06", marks: [{ id: "audited", label, tone: "#2563eb", ink: { light: "#1e3a8a", dark: "#bfdbfe" } }] });
  for (const label of ["սnprotected", "ոnprotected".replace("ո", "ս"), "աeb3", "Web३", "Safeⵑ", "ꓪeb3"]) {
    assert.deepEqual(validateMarks(file(label), "marks.json").issues.map((i) => i.path), ["marks[0].label"], JSON.stringify(label));
  }
  assert.deepEqual(validateMarks(file("Audited"), "marks.json").issues, []);
});

const COPY = readFileSync(path.join(here, "..", "src", "confusables.json"));

test("the table of lookalikes is Unicode's, at the version and hash this tool was checked against", () => {
  assert.equal(CONFUSABLES_VERSION, "18.0.0");
  assert.equal(createHash("sha256").update(COPY).digest("hex"), "ff39d1cc9a2b920736da3a591c86a6b470ba88a01b02448d879d6e859947cba1");
  assert.ok((JSON.parse(COPY.toString("utf8")) as { table: string }).table.split(" ").length > 6000);
});

test("the numbers every mark is bounded by are Orivon's", () => {
  assert.equal(MAX_LABEL, 12);
  assert.equal(MAX_NOTE, 300);
  assert.equal(MAX_ICON_PATH, 1024);
  assert.equal(MIN_CONTRAST, 4.5);
});

// The copy against the original, byte for byte where it is data and token for token where it is code. It needs an Orivon
// checkout, so it runs when ORIVON_REPO names one (the path of its root).
const orivon = process.env.ORIVON_REPO;
const theirs = (file: string): string => readFileSync(path.join(orivon ?? "", file), "utf8");
const ours = (file: string): string => readFileSync(path.join(here, "..", file), "utf8");
const skip = orivon !== undefined && existsSync(path.join(orivon, "src", "trust", "mark-values.ts")) ? false : "set ORIVON_REPO to an Orivon checkout to compare the copy with it";

/** The tokens of a source text that carry its meaning: numbers, quoted text and regular expressions, with the quote marks made alike. */
const tokens = (source: string, start: string, end: string): string[] => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `no ${start}`);
  const block = source.slice(from, source.indexOf(end, from));
  return (block.match(/0x[0-9a-fA-F]+|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g) ?? []).map((token) => (token.startsWith("0x") ? token.toLowerCase() : `"${token.slice(1, -1)}"`));
};

test("the table of lookalikes and its notice are Orivon's, byte for byte", { skip }, () => {
  assert.equal(ours("src/confusables.json"), theirs("src/trust/confusables.json"));
  assert.equal(ours("src/confusables.LICENSE.txt"), theirs("src/trust/confusables.LICENSE.txt"));
});

test("the lookalikes the table leaves out are Orivon's", { skip }, () => {
  const mine = tokens(ours("src/confusables.ts"), "const ALSO_READ", "const ALSO:");
  assert.ok(mine.length > 40);
  assert.deepEqual(mine, tokens(theirs("src/trust/confusables.ts"), "const ALSO_READ", "const ALSO:"));
});

test("the constants, the unsafe characters and the reserved words are Orivon's", { skip }, () => {
  const line = (source: string, name: string): string => {
    const found = new RegExp(`^(?:export )?const ${name}\\b.*$`, "m").exec(source);
    assert.ok(found, `no ${name}`);
    return found[0].replace(/^export /, "").replace(/;$/, "").replace(/'/g, '"').replace(/^(const \w+)\s*:[^=]*= /, "$1 = ").trim();
  };
  const orivonMarks = theirs("src/trust/mark-values.ts");
  const ownMarks = ours("src/mark-values.ts");
  for (const name of ["MARK_ID", "MAX_LABEL", "MAX_NOTE", "MAX_ICON_PATH", "MIN_CONTRAST", "PLATE_TINT", "LIGHT_SURFACE", "DARK_SURFACE", "UNSAFE", "HEX_COLOUR", "ARGUMENTS", "NUMBER", "MAX_COORDINATE", "MAX_ROTATION"]) {
    assert.equal(line(ownMarks, name), line(orivonMarks, name), name);
  }
  assert.equal(line(ours("src/reserved-words.ts"), "RESERVED"), line(theirs("src/trust/reserved-words.ts"), "RESERVED"));
});
