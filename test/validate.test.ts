import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalise } from "../src/identifiers.ts";
import { findDuplicateIds, validateProvider, validateSource } from "../src/validate.ts";
import { SHA_A, SHA_B, website } from "./support.ts";

const messages = (value: unknown, dir?: "website" | "operation" | "connection") =>
  validateSource(value, "f.json", dir).issues.map((i) => `${i.path}: ${i.message}`);

const rejects = (value: unknown, path: string, dir?: "website" | "operation" | "connection") =>
  assert.ok(messages(value, dir).some((m) => m.startsWith(`${path}:`)), `expected an error at ${path}, got ${messages(value, dir).join(" | ")}`);

const accepts = (value: unknown, dir?: "website" | "operation" | "connection") =>
  assert.deepEqual(messages(value, dir), []);

test("a minimal website evaluation is accepted", () => accepts(website(), "website"));

test("required fields", () => {
  for (const key of ["subject", "ids", "name", "evaluated", "trustlessity"]) {
    const value = website();
    delete value[key];
    rejects(value, key);
  }
});

test("string length limits", () => {
  accepts(website({ name: "n".repeat(80), version: "v".repeat(40), summary: "s".repeat(600) }));
  rejects(website({ name: "n".repeat(81) }), "name");
  rejects(website({ name: "" }), "name");
  rejects(website({ version: "v".repeat(41) }), "version");
  rejects(website({ summary: "s".repeat(601) }), "summary");
  rejects(website({ operations: [{ name: "x", trustlessity: { level: 1 }, note: "n".repeat(301) }] }), "operations[0].note");
});

test("evaluated is a real date", () => {
  accepts(website({ evaluated: "2024-02-29" }));
  rejects(website({ evaluated: "2026-02-30" }), "evaluated");
  rejects(website({ evaluated: "2026-1-3" }), "evaluated");
});

test("scales per subject", () => {
  accepts(website({ trustlessity: { level: 4 } }));
  rejects(website({ trustlessity: { level: 5 } }), "trustlessity.level");
  rejects(website({ trustlessity: { level: 0 } }), "trustlessity.level");
  rejects(website({ trustlessity: { level: 2.5 } }), "trustlessity.level");
  const op = (level: number) => ({ subject: "operation", ids: ["caip10:eip155:1:0xab"], name: "Op", evaluated: "2026-10-03", trustlessity: { level } });
  accepts(op(5), "operation");
  rejects(op(6), "trustlessity.level", "operation");
  const conn = (level: number) => ({ subject: "connection", ids: ["caip2:eip155:1"], name: "C", evaluated: "2026-10-03", trustlessity: { level } });
  accepts(conn(3), "connection");
  rejects(conn(4), "trustlessity.level", "connection");
});

test("privacy is allowed only where the scale says", () => {
  accepts(website({ trustlessity: { level: 4, privacy: true } }));
  rejects(website({ trustlessity: { level: 3, privacy: true } }), "trustlessity.privacy");
  const op = (level: number, privacy: boolean) => ({ subject: "operation", ids: ["caip10:eip155:1:0xab"], name: "Op", evaluated: "2026-10-03", trustlessity: { level, privacy } });
  accepts(op(4, true));
  accepts(op(5, true));
  rejects(op(3, true), "trustlessity.privacy");
  const conn = (level: number, privacy: boolean) => ({ subject: "connection", ids: ["caip2:eip155:1"], name: "C", evaluated: "2026-10-03", trustlessity: { level, privacy } });
  accepts(conn(3, true));
  rejects(conn(2, true), "trustlessity.privacy");
  accepts(website({ trustlessity: { level: 3, privacy: false } }));
});

test("operations and connections only on a website, parts on their own scales", () => {
  const part = { name: "p", trustlessity: { level: 3, privacy: false } };
  accepts(website({ operations: [part], connections: [{ ...part, trustlessity: { level: 3, privacy: true } }] }));
  rejects(website({ operations: [{ ...part, trustlessity: { level: 6 } }] }), "operations[0].trustlessity.level");
  rejects(website({ connections: [{ ...part, trustlessity: { level: 4 } }] }), "connections[0].trustlessity.level");
  const op = { subject: "operation", ids: ["caip10:eip155:1:0xab"], name: "Op", evaluated: "2026-10-03", trustlessity: { level: 2 } };
  rejects({ ...op, operations: [part] }, "operations", "operation");
  rejects(website({ operations: Array.from({ length: 33 }, () => part) }), "operations");
  accepts(website({ operations: Array.from({ length: 32 }, () => part) }));
});

test("part ids must be identifiers of the part's subject", () => {
  const op = (id: string) => website({ operations: [{ name: "p", trustlessity: { level: 1 }, id }] });
  accepts(op("caip10:eip155:1:0xab"));
  rejects(op("caip2:eip155:1"), "operations[0].id");
  const conn = (id: string) => website({ connections: [{ name: "p", trustlessity: { level: 1 }, id }] });
  accepts(conn("origin:https://api.example.com"));
  accepts(conn("caip2:eip155:1"));
  rejects(conn(SHA_A), "connections[0].id");
});

test("evidence entries are absolute http, https, ipfs or ipns addresses, at most 10", () => {
  accepts(website({ evidence: ["https://a.example/x", "http://b.example", "ipfs://bafy/x", "ipns://k51/x"] }));
  rejects(website({ evidence: ["ftp://a.example"] }), "evidence[0]");
  rejects(website({ evidence: ["/relative/path"] }), "evidence[0]");
  rejects(website({ evidence: ["not a url"] }), "evidence[0]");
  rejects(website({ evidence: Array.from({ length: 11 }, () => "https://a.example") }), "evidence");
});

test("subject must equal the directory, and be a known subject", () => {
  accepts(website(), "website");
  rejects(website(), "subject", "connection");
  rejects(website({ subject: "planet" }), "subject");
});

test("identifier types per subject", () => {
  rejects(website({ ids: ["caip2:eip155:1"] }), "ids[0]");
  rejects(website({ ids: ["origin:https://a.example"] }), "ids[0]");
  rejects(website({ ids: ["nonsense"] }), "ids[0]");
  const op = (id: string) => ({ subject: "operation", ids: [id], name: "Op", evaluated: "2026-10-03", trustlessity: { level: 2 } });
  rejects(op(SHA_A), "ids[0]", "operation");
});

test("ids: 1 to 8 entries, none repeated", () => {
  rejects(website({ ids: [] }), "ids");
  rejects(website({ ids: Array.from({ length: 9 }, (_, i) => `sha256:${String(i).repeat(64)}`) }), "ids");
  accepts(website({ ids: Array.from({ length: 8 }, (_, i) => `sha256:${String(i).repeat(64)}`) }));
  rejects(website({ ids: [SHA_A, SHA_A] }), "ids[1]");
  rejects(website({ ids: [SHA_A, SHA_A.toUpperCase().replace("SHA256", "sha256")] }), "ids[1]");
});

test("an identifier listed by two evaluations is an error", () => {
  const one = validateSource(website({ ids: [SHA_A] }), "one.json").evaluation!;
  const two = validateSource(website({ ids: [SHA_B, SHA_A] }), "two.json").evaluation!;
  const issues = findDuplicateIds([{ file: "one.json", evaluation: one }, { file: "two.json", evaluation: two }]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.file, "two.json");
  assert.deepEqual(findDuplicateIds([{ file: "one.json", evaluation: one }]), []);
});

test("unknown fields are errors in source files", () => {
  rejects(website({ sumary: "typo" }), "sumary");
  rejects(website({ id: SHA_A }), "id");
  rejects(website({ trustlessity: { level: 3, privcy: true } }), "trustlessity.privcy");
  rejects(website({ operations: [{ name: "p", trustlessity: { level: 1 }, notes: "x" }] }), "operations[0].notes");
});

test("a valid evaluation round-trips with canonical ids", () => {
  const { evaluation } = validateSource(website({ ids: [`sha256:${"AB".repeat(32)}`] }), "f.json", "website");
  assert.equal(evaluation!.ids[0], `sha256:${"ab".repeat(32)}`);
  assert.equal(evaluation!.trustlessity.privacy, false);
});

test("canonicalisation: uppercase sha256 is lowercased, short sha256 is refused", () => {
  const up = canonicalise(`sha256:${"AB".repeat(32)}`, "website");
  assert.deepEqual(up, { ok: true, type: "sha256", id: `sha256:${"ab".repeat(32)}` });
  assert.equal(canonicalise("sha256:abc", "website").ok, false);
});

test("canonicalisation: CIDv0 becomes base32 CIDv1", () => {
  const v0 = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
  const result = canonicalise(`cid:${v0}`, "website");
  assert.ok(result.ok);
  assert.match(result.id, /^cid:bafybei[a-z2-7]+$/);
  const v1 = canonicalise(result.id, "website");
  assert.deepEqual(v1, result);
  assert.equal(canonicalise("cid:not-a-cid", "website").ok, false);
});

test("canonicalisation: caip10, caip2 and origin", () => {
  assert.equal(canonicalise("caip10:eip155:1:0xAbC", "operation").ok, true);
  assert.equal(canonicalise("caip10:eip155:1", "operation").ok, false);
  assert.equal(canonicalise("caip2:eip155:1", "connection").ok, true);
  assert.equal(canonicalise("caip2:eip155", "connection").ok, false);
  assert.deepEqual(canonicalise("origin:https://Api.Example.com:8443", "connection"), {
    ok: true,
    type: "origin",
    id: "origin:https://api.example.com:8443",
  });
  for (const bad of ["origin:http://a.example", "origin:https://a.example/", "origin:https://a.example/x", "origin:https://a.example?q=1", "origin:https://u@a.example"]) {
    assert.equal(canonicalise(bad, "connection").ok, false, bad);
  }
});

test("provider.json rules", () => {
  const ok = { standard: "orivon-web3-score/1", name: "P", bucketHexChars: 2, about: "https://a.example" };
  assert.deepEqual(validateProvider(ok, "p.json").issues, []);
  const bad = (patch: Record<string, unknown>) => validateProvider({ ...ok, ...patch }, "p.json").issues.length > 0;
  assert.ok(bad({ standard: "orivon-web3-score/2" }));
  assert.ok(bad({ name: "" }));
  assert.ok(bad({ name: "n".repeat(81) }));
  assert.ok(bad({ bucketHexChars: 0 }));
  assert.ok(bad({ bucketHexChars: 3 }));
  assert.ok(bad({ bucketHexChars: 4 }));
  assert.ok(bad({ bucketHexChars: 2.5 }));
  assert.ok(bad({ extra: 1 }));
  assert.deepEqual(validateProvider({ standard: "orivon-web3-score/1", name: "P", bucketHexChars: 1 }, "p.json").issues, []);
});

test("errors are collected, not thrown one at a time", () => {
  const value = website({ name: "", evaluated: "nope", trustlessity: { level: 9 }, sumary: "x" });
  assert.ok(messages(value).length >= 4);
});
