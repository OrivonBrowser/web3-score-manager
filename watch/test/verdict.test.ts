import assert from "node:assert/strict";
import { test } from "node:test";
import { findSecrets, validateVerdict } from "../verdict.ts";
import { goodVerdict } from "./support.ts";

const issuesOf = (v: unknown) => validateVerdict(v).issues;

test("a good answer passes and keeps its fields", () => {
  const got = validateVerdict(goodVerdict({ version: "1.2.3" }));
  assert.deepEqual(got.issues, []);
  assert.equal(got.verdict?.version, "1.2.3");
  assert.deepEqual(got.verdict?.connections, [{ name: "Indexer", level: 1, note: "From a server." }]);
});

test("a missing required field is named", () => {
  const v = goodVerdict();
  delete v.concerns;
  assert.deepEqual(issuesOf(v), ["concerns: required"]);
});

test("an extra key is refused at the top and inside a part", () => {
  assert.ok(issuesOf(goodVerdict({ score: 4 })).includes("score: unknown field"));
  assert.ok(issuesOf(goodVerdict({ operations: [{ name: "x", level: 1, id: "y" }] })).includes("operations[0].id: unknown field"));
});

test("types, lengths and ranges follow the schema", () => {
  assert.ok(issuesOf(goodVerdict({ renders: "yes" })).length > 0);
  assert.ok(issuesOf(goodVerdict({ level: 5 })).length > 0);
  assert.ok(issuesOf(goodVerdict({ level: 2.5 })).length > 0);
  assert.ok(issuesOf(goodVerdict({ name: "" })).length > 0);
  assert.ok(issuesOf(goodVerdict({ summary: "x".repeat(601) })).length > 0);
  assert.ok(issuesOf(goodVerdict({ changes: "x".repeat(801) })).length > 0);
  assert.ok(issuesOf(goodVerdict({ version: "x".repeat(41) })).length > 0);
  assert.ok(issuesOf(goodVerdict({ operations: [{ name: "x", level: 6 }] })).length > 0);
  assert.ok(issuesOf(goodVerdict({ connections: [{ name: "x", level: 4 }] })).length > 0);
  assert.ok(issuesOf(goodVerdict({ connections: Array.from({ length: 33 }, () => ({ name: "x", level: 1 })) })).length > 0);
  assert.ok(issuesOf(goodVerdict({ evidence: Array.from({ length: 11 }, () => "https://a.example/") })).length > 0);
  assert.ok(issuesOf("text").length > 0);
});

test("privacy only at website level 4, operation level 4 or 5, connection level 3", () => {
  assert.deepEqual(issuesOf(goodVerdict({ level: 4, privacy: true })), []);
  assert.ok(issuesOf(goodVerdict({ level: 3, privacy: true })).some((m) => m.startsWith("privacy:")));
  assert.deepEqual(issuesOf(goodVerdict({ operations: [{ name: "x", level: 5, privacy: true }] })), []);
  assert.ok(issuesOf(goodVerdict({ operations: [{ name: "x", level: 3, privacy: true }] })).length > 0);
  assert.deepEqual(issuesOf(goodVerdict({ connections: [{ name: "x", level: 3, privacy: true }] })), []);
  assert.ok(issuesOf(goodVerdict({ connections: [{ name: "x", level: 2, privacy: true }] })).length > 0);
});

test("evidence must be one absolute http, https, ipfs or ipns address", () => {
  for (const bad of ["github.com/x", "javascript:alert(1)", "https://a b", "ftp://a.example/", "https://", ""]) {
    assert.ok(issuesOf(goodVerdict({ evidence: [bad] })).length > 0, bad);
  }
  assert.deepEqual(issuesOf(goodVerdict({ evidence: ["ipfs://bafy/x", "ipns://example.eth", "http://a.example/"] })), []);
});

test("findSecrets sees known secrets of 8+ characters and token shapes, never short ones", () => {
  assert.equal(findSecrets("plain text", ["supersecretvalue"]), false);
  assert.equal(findSecrets("has supersecretvalue inside", ["supersecretvalue"]), true);
  assert.equal(findSecrets("has abc inside", ["abc"]), false);
  assert.equal(findSecrets("key sk-ant-oat01-abcdefghijklmnop", []), true);
  assert.equal(findSecrets(`bot 123456789:${"A".repeat(35)}`, []), true);
  assert.equal(findSecrets("-----BEGIN OPENSSH PRIVATE KEY-----", []), true);
  assert.equal(findSecrets(`token ghp_${"a".repeat(36)}`, []), true);
  assert.equal(findSecrets("fake_value_12345678-1234-1234-1234-123456789abc", []), true);
  assert.equal(findSecrets("level 3, 2026-10-21, bafybeib77kqm53u6qpfczltq56iqbswwtgxqi435e4redd3cdgydkvtbui", []), false);
});
