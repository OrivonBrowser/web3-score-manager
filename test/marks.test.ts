import assert from "node:assert/strict";
import { test } from "node:test";
import { DARK_SURFACE, LIGHT_SURFACE, MIN_CONTRAST, colourOf, iconPathOf, isMarkId, markLabel, plainText, plateContrast } from "../src/mark-values.ts";
import { validateMarks } from "../src/marks.ts";
import { reservedWordsIn } from "../src/reserved-words.ts";

// The strings below are the ones src/trust/tests/mark-values.test.ts and provider-marks.test.ts of Orivon read, so a mark
// this tool accepts is a mark Orivon draws and one this tool refuses is one Orivon refuses.

const mark = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "audited",
  label: "Audited",
  tone: "#2563eb",
  ink: { light: "#1e3a8a", dark: "#bfdbfe" },
  ...overrides,
});

const file = (marks: unknown, extra: Record<string, unknown> = {}): unknown => ({
  standard: "orivon-web3-score/1",
  subject: "marks",
  updated: "2026-11-05",
  marks,
  ...extra,
});

const check = (marks: unknown, extra: Record<string, unknown> = {}) => validateMarks(file(marks, extra), "marks.json");
const paths = (marks: unknown, extra: Record<string, unknown> = {}) => check(marks, extra).issues.map((i) => i.path);
const valid = (marks: unknown) => assert.deepEqual(check(marks).issues, []);

test("isMarkId is a lower-case word of at most 24 characters that starts with a letter", () => {
  for (const id of ["a", "audited", "web3-ok", "x".repeat(24), "a1-b2"]) assert.equal(isMarkId(id), true, id);
  for (const id of ["", "Audited", "1a", "-a", "a_b", "a b", "x".repeat(25), "café", "a\n", 3, null, undefined, ["a"]]) assert.equal(isMarkId(id), false, String(id));
});

test("plainText counts characters, bounds the length and refuses what a plate must not draw", () => {
  assert.equal(plainText("Café", 1, 4), "Café");
  assert.equal(plainText("😀".repeat(3), 1, 3), "😀".repeat(3));
  assert.equal(plainText("😀".repeat(4), 1, 3), undefined);
  assert.equal(plainText("", 1, 5), undefined);
  assert.equal(plainText("", 0, 5), "");
  assert.equal(plainText("Audit: 监管, ok.", 1, 40), "Audit: 监管, ok.");
  const refused: [string, string][] = [
    ["a newline", "a\nb"],
    ["a tab", "a\tb"],
    ["a NUL", "a\u0000b"],
    ["a right-to-left override", "a‮b"],
    ["a left-to-right isolate", "a⁦b"],
    ["an Arabic letter mark", "a؜b"],
    ["a zero-width space", "a​b"],
    ["a zero-width joiner", "a‍b"],
    ["a word joiner", "a⁠b"],
    ["a byte-order mark", "a﻿b"],
    ["a soft hyphen", "a­b"],
    ["a tag character", "a\u{e0041}b"],
    ["a no-break space", "a b"],
    ["an em space", "a b"],
    ["a line separator", "a b"],
    ["a Hangul filler", "aㅤb"],
    ["a combining grapheme joiner", "a͏b"],
    ["an unpaired surrogate", "a\ud800b"],
    ["a private-use character", "ab"],
    ["an unassigned character", "a͸b"],
  ];
  for (const [why, text] of refused) assert.equal(plainText(text, 1, 20), undefined, why);
  for (const value of [1, null, undefined, {}, ["a"]]) assert.equal(plainText(value, 0, 20), undefined);
});

test("markLabel", () => {
  for (const label of ["Audited", "Two words", "监管", "Привет", "Ελέγχθη"]) assert.equal(markLabel(label), label);
  const refused: [string, string][] = [
    ["empty", ""],
    ["past 12 characters", "Thirteen char"],
    ["blank", "   "],
    ["led by a space", " Audited"],
    ["ended by a space", "Audited "],
    ["holding a bidirectional control", "Au‮d"],
    ["mixing Latin and Cyrillic", "Wеb"],
    ["mixing Latin and Greek", "Audιt"],
    ["mixing Cyrillic and Greek", "Прιвет"],
    ["stacking combining marks", `A${"̍".repeat(11)}`],
  ];
  for (const [why, label] of refused) assert.equal(markLabel(label), undefined, why);
});

test("reservedWordsIn reads what a label draws as", () => {
  const cases: [string, string[]][] = [
    ["Web2", ["web2"]],
    ["Web2.5", ["web25"]],
    ["WEB3", ["web3"]],
    ["Web?", ["web?"]],
    ["Unprotected", ["unprotected"]],
    ["Warning", ["warning"]],
    ["Safe!", ["!"]],
    ["Web 3", ["web3"]],
    ["web-3", ["web3"]],
    ["W.E.B 2.5", ["web25"]],
    ["Wéb3", ["web3"]],
    ["Ｗｅｂ３", ["web3"]],
    ["Not unprotected", ["unprotected"]],
    ["Web3 warning", ["web3", "warning"]],
    ["Web2 Web3", ["web2", "web3"]],
    ["ԜЕВ" + "3", ["web3"]],
    ["ԜΕΒ" + "3", ["web3"]],
    ["ᏔᎬᏴ" + "3", ["web3"]],
    ["WebƷ", ["web3"]],
    ["Web‐" + "3", ["web3"]],
    ["Web‑" + "3", ["web3"]],
    ["Web–" + "3", ["web3"]],
    ["Web−" + "3", ["web3"]],
    ["Web/3", ["web3"]],
    ["❗", ["!"]],
    ["ǃ", ["!"]],
    ["ꓪ" + "eb3", ["web3"]],
    ["ա" + "eb3", ["web3"]],
    ["Web" + "३", ["web3"]],
    ["Safe" + "ⵑ", ["!"]],
    ["Unpr0tected", ["unprotected"]],
    ["Ս" + "nprotected", ["unprotected"]],
    ["ս" + "nprotected", ["unprotected"]],
    ["WARNING", ["warning"]],
  ];
  for (const [label, words] of cases) assert.deepEqual(reservedWordsIn(label), words, label);
  for (const label of ["Audited", "Webby", "Spider web", "Trusted", "Web", "Wave 2"]) assert.deepEqual(reservedWordsIn(label), [], label);
});

test("colourOf reads #rrggbb in either case and writes it in lower case", () => {
  assert.equal(colourOf("#22C55E"), "#22c55e");
  for (const value of ["#fff", "#ffff", "#22c55e80", "22c55e", "#22c55g", "red", "rgb(1,2,3)", "var(--x)", "#22c55e;", "#22c55e\n", " #22c55e", "url(#a)", "", 7, null, undefined]) {
    assert.equal(colourOf(value), undefined, String(value));
  }
});

test("plateContrast measures the ink on the tone's tint over the surface: 13% at rest unless a tint is given", () => {
  assert.ok(Math.abs(plateContrast("#ffffff", "#000000", "#ffffff") - 21) < 1e-5);
  assert.ok(Math.abs(plateContrast("#ffffff", "#ffffff", "#ffffff") - 1) < 1e-5);
  assert.ok(Math.abs(plateContrast("#000000", "#4a4a4a", LIGHT_SURFACE) - 5.23) < 0.01);
  assert.ok(Math.abs(plateContrast("#000000", "#4a4a4a", LIGHT_SURFACE, 0.22) - 4.19) < 0.01);
  assert.equal(LIGHT_SURFACE, "#e4e4eb");
  assert.equal(DARK_SURFACE, "#35294b");
});

test("iconPathOf writes a path back as commands and numbers, and refuses what Orivon refuses", () => {
  assert.equal(iconPathOf("M12 2 L22 22 L2 22 Z"), "M 12 2 L 22 22 L 2 22 Z");
  assert.equal(iconPathOf("M1 2 3 4 5 6"), "M 1 2 L 3 4 L 5 6");
  assert.equal(iconPathOf("M1-2L3.5.5"), "M 1 -2 L 3.5 0.5");
  assert.equal(iconPathOf("M0 0a1 1 0 011 1"), "M 0 0 a 1 1 0 0 1 1 1");
  assert.equal(iconPathOf("M100 -100 A1 1 360 0 0 1 1"), "M 100 -100 A 1 1 360 0 0 1 1");
  const refused: [string, unknown][] = [
    ["empty", ""],
    ["only blanks", "   "],
    ["not text", 3],
    ["no moveto first", "L1 1"],
    ["a command that is not SVG's", "M0 0 X1 1"],
    ["an exponent", "M1e1 2"],
    ["a plus sign", "M+1 2"],
    ["too few numbers", "M0 0 L1"],
    ["numbers after a close", "M0 0 L1 1 Z 2 2"],
    ["a number past the bound", "M101 0"],
    ["a huge number", "M99999999999999999999999 0"],
    ["a rotation past the bound", "M0 0 A1 1 361 0 0 1 1"],
    ["an arc flag that is not 0 or 1", "M0 0 A1 1 0 2 0 1 1"],
    ["a url", "M0 0 url(http://x)"],
    ["markup", "M0 0 </path><script>"],
    ["a style", "M0 0 L1 1;fill:red"],
    ["a letter beyond ASCII", "M0 0 L1 1 é"],
    ["a dot with no digits", "M. 0"],
    ["past the character bound", `M0 0 ${"L1 1 ".repeat(300)}`],
  ];
  for (const [why, d] of refused) assert.equal(iconPathOf(d), undefined, why);
});

test("a file with one mark of its own, which restyles nothing, is valid and is written back in Orivon's form", () => {
  const checked = check([mark({ icon: { path: "M12 2 L22 22 L2 22 Z" }, note: "Checked by hand.", tone: "#2563EB" })]);
  assert.deepEqual(checked.issues, []);
  assert.deepEqual(checked.marks, {
    standard: "orivon-web3-score/1",
    subject: "marks",
    updated: "2026-11-05",
    marks: [{ id: "audited", label: "Audited", tone: "#2563eb", ink: { light: "#1e3a8a", dark: "#bfdbfe" }, icon: { path: "M 12 2 L 22 22 L 2 22 Z" }, note: "Checked by hand." }],
  });
});

test("a file of no marks, and of exactly the most, is valid; one past the most is not", () => {
  valid([]);
  valid(Array.from({ length: 16 }, (_, n) => mark({ id: `mark-${n}` })));
  assert.deepEqual(paths(Array.from({ length: 17 }, (_, n) => mark({ id: `mark-${n}` }))), ["marks"]);
});

test("the file itself: standard, subject, a real date and a list of marks", () => {
  assert.deepEqual(validateMarks(null, "m").issues.map((i) => i.path), ["(root)"]);
  assert.deepEqual(validateMarks([], "m").issues.map((i) => i.path), ["(root)"]);
  assert.deepEqual(paths([], { standard: "orivon-web3-score/2" }), ["standard"]);
  assert.deepEqual(paths([], { subject: "filters" }), ["subject"]);
  for (const updated of ["yesterday", "2026-13-45", "2026-02-30", undefined, 7]) assert.deepEqual(paths([], { updated }), ["updated"], String(updated));
  assert.deepEqual(paths({}), ["marks"]);
  assert.deepEqual(paths(undefined), ["marks"]);
  assert.deepEqual(paths([], { version: 2 }), ["version"]);
});

test("a value Orivon refuses is an error at that value", () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ["a short hex", { tone: "#25b" }, "tone"],
    ["a colour name", { tone: "blue" }, "tone"],
    ["a function", { tone: "rgb(1, 2, 3)" }, "tone"],
    ["a variable", { tone: "var(--wlevel4)" }, "tone"],
    ["an alpha channel", { tone: "#2563eb80" }, "tone"],
    ["style text", { tone: "#2563eb; background: url(x)" }, "tone"],
    ["no tone", { tone: undefined }, "tone"],
    ["a light ink that is not a colour", { ink: { light: "dark", dark: "#bfdbfe" } }, "ink.light"],
    ["a dark ink that is missing", { ink: { light: "#1e3a8a" } }, "ink.dark"],
    ["an ink that is one colour", { ink: "#1e3a8a" }, "ink"],
    ["no ink", { ink: undefined }, "ink"],
    ["an id with a capital", { id: "Audited" }, "id"],
    ["an id with an underscore", { id: "au_dited" }, "id"],
    ["an id past 24 characters", { id: "a".repeat(25) }, "id"],
    ["no id", { id: undefined }, "id"],
    ["a note past 300 characters", { note: "x".repeat(301) }, "note"],
    ["a note that is not text", { note: 4 }, "note"],
    ["a note that is null", { note: null }, "note"],
    ["a note with a bidirectional control", { note: "Fine ‮." }, "note"],
    ["a restyle of Web?", { restyles: "web?" }, "restyles"],
    ["a restyle of Unprotected", { restyles: "unprotected" }, "restyles"],
    ["a restyle that is not text", { restyles: 3 }, "restyles"],
    ["an icon that is text", { icon: "M0 0 L1 1" }, "icon"],
    ["an icon that is null", { icon: null }, "icon"],
    ["an icon with no path", { icon: {} }, "icon.path"],
    ["an icon whose path is markup", { icon: { path: "<svg onload=alert(1)>" } }, "icon.path"],
    ["an icon whose path is not a path", { icon: { path: "javascript:alert(1)" } }, "icon.path"],
    ["an icon whose path breaks the grammar", { icon: { path: "M0 0 L1" } }, "icon.path"],
    ["an icon whose path has a huge number", { icon: { path: "M0 0 L1e308 1" } }, "icon.path"],
    ["a label with a right-to-left override", { label: "Au‮dited" }, "label"],
    ["a label with a zero-width space", { label: "Au​dited" }, "label"],
    ["a label with a new line", { label: "Au\ndited" }, "label"],
    ["a label past 12 characters", { label: "Thirteen char" }, "label"],
    ["an empty label", { label: "" }, "label"],
    ["a blank label", { label: "  " }, "label"],
    ["a label that is not text", { label: 7 }, "label"],
    ["a field Orivon ignores, misspelt", { restyle: "web3" }, "restyle"],
  ];
  for (const [why, fields, path] of cases) {
    const got = paths([mark(fields)]);
    assert.ok(got.includes(`marks[0].${path}`), `${why}: expected marks[0].${path}, got ${got.join(", ")}`);
  }
});

test("an icon path whose written form is exactly 1 KiB is valid and one more character is not", () => {
  // Written back, a group is a command and its values with one space between: 169 of "L1 1" make 1019 characters.
  const fits = `M0 0${" L10 1".repeat(5)}${" L1 1".repeat(164)}`;
  assert.equal(iconPathOf(fits)?.length, 1024);
  valid([mark({ icon: { path: fits } })]);
  const over = `${fits} L1 1`;
  assert.equal(iconPathOf(over), undefined);
  assert.deepEqual(paths([mark({ icon: { path: over } })]), ["marks[0].icon.path"]);
});

test("a compact path under 1024 characters is refused when it is longer written back, and the message says so", () => {
  const compact = `M0 0${"l1 1".repeat(250)}`;
  assert.equal(compact.length, 1004);
  assert.equal(iconPathOf(compact), undefined);
  const [issue] = check([mark({ icon: { path: compact } })]).issues;
  assert.equal(issue?.path, "marks[0].icon.path");
  assert.match(issue?.message ?? "", /at most 1024 characters as written back/);
  valid([mark({ icon: { path: `M0 0${"l1 1".repeat(169)}` } })]);
  assert.equal(iconPathOf(`M0 0${"l1 1".repeat(2000)}`), undefined);
});

test("two marks with one id, a mark that is not an object, and two restyles of one grade are errors", () => {
  assert.deepEqual(paths([mark(), mark({ label: "Other" })]), ["marks[1].id"]);
  assert.deepEqual(paths([mark(), "audited"]), ["marks[1]"]);
  assert.deepEqual(paths([null]), ["marks[0]"]);
  const web3 = { id: "look3", label: "Web3", restyles: "web3" };
  assert.deepEqual(paths([mark(web3), mark({ ...web3, id: "other" })]), ["marks[1].restyles"]);
  valid([mark(web3), mark({ id: "other", label: "Web2", restyles: "web2" })]);
});

test("a new mark may not be, or contain, a word Orivon draws itself", () => {
  const words = ["Web2", "Web2.5", "Web3", "Web?", "Unprotected", "Warning", "WEB3", "web 3", "Wéb3", "Safe!", "Web3 ok", "Un-protected"];
  for (const label of words) assert.deepEqual(paths([mark({ label })]), ["marks[0].label"], label);
  const lookalikes = ["ԜЕВ" + "3", "ԜΕΒ" + "3", "ᏔᎬᏴ" + "3", "WebƷ", "Web‐" + "3", "Web‑" + "3", "Web–" + "3", "Web−" + "3", "Web/3", "❗", "ǃ"];
  for (const label of lookalikes) {
    assert.deepEqual(paths([mark({ label })]), ["marks[0].label"], `${label} added`);
    assert.deepEqual(paths([mark({ label, restyles: "web2" })]), ["marks[0].label"], `${label} restyling web2`);
  }
  assert.deepEqual(paths([mark({ label: "Wеb3" })]), ["marks[0].label"]);
  const pairs = ["VVeb3", "Vveb3", "uueb3", "\\/\\/eb3", "Waming", "UnprotecteCI", "We|o3", "Uriprotected"];
  for (const label of pairs) {
    assert.deepEqual(paths([mark({ label })]), ["marks[0].label"], `${label} added`);
    assert.deepEqual(paths([mark({ label, restyles: "web2" })]), ["marks[0].label"], `${label} restyling web2`);
  }
  for (const label of ["Webby", "Spider web", "Trusted", "Verified"]) valid([mark({ label })]);
});

test("a mark that restyles a grade carries that grade's word and no other", () => {
  valid([mark({ id: "web3", label: "Web3", restyles: "web3" })]);
  valid([mark({ id: "web25", label: "Web2.5", restyles: "web25" })]);
  valid([mark({ id: "web2", label: "Web2", restyles: "web2" })]);
  for (const [label, restyles] of [["Web3", "web2"], ["Web2.5", "web2"], ["Web2", "web25"], ["Web3 Warning", "web3"], ["Web?", "web3"], ["Unprotected", "web2"]] as const) {
    assert.deepEqual(paths([mark({ label, restyles })]), ["marks[0].label"], `${label} restyling ${restyles}`);
  }
});

test("a restyle is labelled with its grade's word and nothing more, or Orivon never draws it", () => {
  for (const label of ["Web2", "WEB 2", "Wéb2", "web-2", "VVeb2"]) valid([mark({ id: "web2", label, restyles: "web2" })]);
  valid([mark({ id: "web25", label: "Web 2.5", restyles: "web25" })]);
  valid([mark({ id: "web3", label: "VVeb3", restyles: "web3" })]);
  for (const label of ["Legacy", "Web2 plus", "Old Web2", "Web 2 beta", "\\/\\/eb2", "★"]) {
    const [issue] = check([mark({ id: "web2", label, restyles: "web2" })]).issues;
    assert.equal(issue?.path, "marks[0].label", label);
  }
  assert.match(check([mark({ id: "web2", label: "Legacy", restyles: "web2" })]).issues[0]!.message, /must be the word of the grade it restyles \(web2\)/);
  assert.deepEqual(paths([mark({ id: "web3", label: "\\/\\/eb3", restyles: "web3" })]), ["marks[0].label"]);
});

test("ink that does not reach 4.5:1 on its plate is an error naming the theme and the ratio", () => {
  const faint = (ink: unknown) => check([mark({ ink })]).issues;
  assert.deepEqual(faint({ light: "#93c5fd", dark: "#bfdbfe" }).map((i) => i.path), ["marks[0].ink.light"]);
  assert.deepEqual(faint({ light: "#1e3a8a", dark: "#1e40af" }).map((i) => i.path), ["marks[0].ink.dark"]);
  assert.deepEqual(faint({ light: "#2563eb", dark: "#2563eb" }).map((i) => i.path), ["marks[0].ink.light", "marks[0].ink.dark"]);
  assert.match(faint({ light: "#93c5fd", dark: "#bfdbfe" })[0]!.message, /reaches \d\.\d\d:1 on the plate in the light theme/);
  valid([mark({ tone: "#16a34a", ink: { light: "#14532d", dark: "#bbf7d0" } })]);
});

test("ink that reads on the plate at rest and not under the pointer is an error, which only the 22% tint shows", () => {
  const dim = (ink: unknown, tone = "#000000") => check([mark({ tone, ink })]).issues;
  // 5.23:1 at the 13% tint of black over the toolbar's surface, 4.19:1 at the 22% tint under the pointer.
  assert.ok(plateContrast("#000000", "#4a4a4a", LIGHT_SURFACE) >= MIN_CONTRAST);
  assert.ok(plateContrast("#000000", "#4a4a4a", LIGHT_SURFACE, 0.22) < MIN_CONTRAST);
  assert.deepEqual(dim({ light: "#4a4a4a", dark: "#ffffff" }).map((i) => i.path), ["marks[0].ink.light"]);
  assert.match(dim({ light: "#4a4a4a", dark: "#ffffff" })[0]!.message, /reaches 4\.19:1 on the plate in the light theme, at rest or under the pointer/);
  assert.deepEqual(dim({ light: "#000000", dark: "#d0d0d0" }, "#ffffff").map((i) => i.path), ["marks[0].ink.dark"]);
  assert.deepEqual(dim({ light: "#2a2a2a", dark: "#ffffff" }), []);
});

test("a field Orivon ignores is refused here, at every level, so a typo does not pass for a setting", () => {
  assert.deepEqual(paths([mark({ future: true })]), ["marks[0].future"]);
  assert.deepEqual(paths([mark({ ink: { light: "#1e3a8a", dark: "#bfdbfe", high: "#000000" } })]), ["marks[0].ink.high"]);
  assert.deepEqual(paths([mark({ icon: { path: "M0 0 L1 1", viewBox: "0 0 99 99" } })]), ["marks[0].icon.viewBox"]);
});

test("every error of the file is reported, not the first", () => {
  assert.deepEqual(paths([mark({ tone: "blue", note: 4 }), mark({ id: "Bad" })]), ["marks[0].tone", "marks[0].note", "marks[1].id"]);
});
