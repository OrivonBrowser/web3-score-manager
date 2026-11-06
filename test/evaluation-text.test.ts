import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { plainText } from "../src/mark-values.ts";
import { validateProvider, validateSource } from "../src/validate.ts";
import { website } from "./support.ts";

// Orivon drops a whole evaluation when one string it holds for a person is not plain text (src/trust/mark-values.ts,
// `plainText`), so each such string is refused here. The cases are the ones of orivon-reader.json, whose answers are Orivon's own.

const fixture = JSON.parse(readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "orivon-reader.json"), "utf8")) as {
  plainText: { why: string; text: string; accepted: string | null }[];
};

test("the plain-text rule keeps and refuses what Orivon's does", () => {
  assert.ok(fixture.plainText.length > 10);
  for (const { why, text, accepted } of fixture.plainText) assert.equal(plainText(text, 1, 40) ?? null, accepted, why);
});

test("every string an evaluation or a descriptor holds for a person is read by that rule", () => {
  const at = (value: unknown) => validateSource(value, "f.json", "website").issues.map((i) => i.path);
  for (const { why, text, accepted } of fixture.plainText) {
    const expect = (path: string[]) => (accepted === null ? path : []);
    assert.deepEqual(at(website({ name: text })), expect(["name"]), `name with ${why}`);
    assert.deepEqual(at(website({ summary: text })), expect(["summary"]), `summary with ${why}`);
    assert.deepEqual(at(website({ version: text })), expect(["version"]), `version with ${why}`);
    assert.deepEqual(at(website({ operations: [{ name: text, trustlessity: { level: 1 } }] })), expect(["operations[0].name"]), `part name with ${why}`);
    assert.deepEqual(at(website({ connections: [{ name: "c", trustlessity: { level: 1 }, note: text }] })), expect(["connections[0].note"]), `part note with ${why}`);
    assert.deepEqual(at(website({ warnings: [{ kind: "other", note: text }] })), expect(["warnings[0].note"]), `warning note with ${why}`);
    assert.deepEqual(at(website({ security: { level: 2, note: text } })), expect(["security.note"]), `security note with ${why}`);
    const provider = (value: Record<string, unknown>) => validateProvider({ standard: "orivon-web3-score/1", bucketHexChars: 2, name: "P", ...value }, "provider.json").issues.map((i) => i.path);
    assert.deepEqual(provider({ name: text }), expect(["name"]), `provider name with ${why}`);
  }
});

test("an evidence address or a provider's about address holding what the plain-text rule refuses is refused", () => {
  const evidence = (address: string) => validateSource(website({ evidence: [address] }), "f.json", "website").issues.map((i) => i.path);
  assert.deepEqual(evidence("https://example.org/a"), []);
  for (const bad of ["https://example.org/a‮b", "https://example.org/a‍b", "https://example.org/a͸b", "https://example.org/a\u0000b"]) {
    assert.deepEqual(evidence(bad), ["evidence[0]"], JSON.stringify(bad));
  }
  const about = (address: string) => validateProvider({ standard: "orivon-web3-score/1", bucketHexChars: 2, name: "P", about: address }, "provider.json").issues.map((i) => i.path);
  assert.deepEqual(about("https://example.org/about"), []);
  for (const bad of ["https://example.org/a‮b", "https://example.org/a‍b", "https://example.org/a͸b"]) {
    assert.deepEqual(about(bad), ["about"], JSON.stringify(bad));
  }
});

test("a string is counted in code points of its Unicode form C, as Orivon counts it", () => {
  const at = (value: unknown) => validateSource(value, "f.json", "website").issues.map((i) => i.path);
  assert.deepEqual(at(website({ name: "\u{1F600}".repeat(80) })), []);
  assert.deepEqual(at(website({ name: "\u{1F600}".repeat(81) })), ["name"]);
  assert.deepEqual(at(website({ name: "é".repeat(80) })), []);
});
