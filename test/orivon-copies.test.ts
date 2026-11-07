import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { COPIES, assertCopiesCurrent, differingCopies, digestOf, withoutImports } from "../src/orivon-copies.ts";
import { tempDir } from "./support.ts";

// The checks that keep the files copied from Orivon equal to the originals, run on checkouts made here, so they need no Orivon
// checkout. test/mark-parity.test.ts runs the same comparison on a real one when ORIVON_REPO names it.

const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");

/** An Orivon checkout holding src/trust/ as these copies are, with Orivon's own import lines. */
function orivonLike(): string {
  const dir = tempDir();
  mkdirSync(path.join(dir, "src", "trust"), { recursive: true });
  for (const name of COPIES) cpSync(path.join(root, "src", name), path.join(dir, "src", "trust", name));
  const words = path.join(dir, "src", "trust", "reserved-words.ts");
  writeFileSync(words, readFileSync(words, "utf8").replace("'./confusables.ts'", "'./confusables.js'"));
  const table = path.join(dir, "src", "trust", "confusables.ts");
  writeFileSync(table, readFileSync(table, "utf8").replace(" with { type: 'json' }", ""));
  return dir;
}

test("only import lines are left out of a copy before it is compared", () => {
  assert.equal(withoutImports("import a from './a.js'\nconst x = 1\n"), "const x = 1\n");
  assert.equal(withoutImports("const important = 1\n  import b\n"), "const important = 1\n  import b\n");
  assert.equal(digestOf("import a from './a.js'\nconst x = 1\n"), digestOf("import a from './a.ts' with { type: 'json' }\nconst x = 1\n"));
  assert.notEqual(digestOf("const x = 1\n"), digestOf("const x = 2\n"));
});

test("a copy that differs from its original only in its import lines is current", () => {
  assert.deepEqual(differingCopies(orivonLike(), root), []);
  assertCopiesCurrent(orivonLike(), root);
});

test("a rule changed in Orivon and not in the copy is named", () => {
  const orivon = orivonLike();
  const file = path.join(orivon, "src", "trust", "mark-values.ts");
  writeFileSync(file, readFileSync(file, "utf8").replace("[0.13, 0.22]", "[0.13, 0.22, 0.3]"));
  assert.deepEqual(differingCopies(orivon, root), ["mark-values.ts"]);
  assert.throws(() => assertCopiesCurrent(orivon, root), /copy them again: mark-values\.ts/);
});

test("a changed word list, table or notice is named too, and a missing original", () => {
  const orivon = orivonLike();
  const words = path.join(orivon, "src", "trust", "reserved-words.ts");
  writeFileSync(words, readFileSync(words, "utf8").replace("['rn', 'm']", "['rn', 'm'], ['vv', 'w']"));
  const notice = path.join(orivon, "src", "trust", "confusables.LICENSE.txt");
  writeFileSync(notice, `${readFileSync(notice, "utf8")}\n`);
  assert.deepEqual(differingCopies(orivon, root), ["confusables.LICENSE.txt", "reserved-words.ts"]);
  assert.deepEqual(differingCopies(tempDir(), root), [...COPIES]);
});

test("a release is never checked without an Orivon checkout to compare with", () => {
  assert.throws(() => assertCopiesCurrent(undefined, root), /ORIVON_REPO is not set/);
  assert.throws(() => assertCopiesCurrent("", root), /ORIVON_REPO is not set/);
  assert.throws(() => assertCopiesCurrent(tempDir(), root), /copy them again/);
});
