import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalise, ID_TYPES } from "../src/identifiers.ts";

// The shapes Orivon files a website under (docs/architecture/web3-score-provider.md, Identifiers).
const ARW = "abcDEF0123456789_-abcDEF0123456789_-abcDEF0";
const BTMH = `1220${"ab".repeat(32)}`;
const BTIH = "0a".repeat(20);

test("website identifiers: sha256, cid, arw, btmh and btih", () => {
  assert.deepEqual(ID_TYPES.website, ["sha256", "cid", "arw", "btmh", "btih"]);
  assert.deepEqual(ID_TYPES.operation, ["caip10"]);
  assert.deepEqual(ID_TYPES.connection, ["sha256", "cid", "caip2", "origin"]);
  assert.deepEqual(ID_TYPES.integration, ["integration", "sha256"]);
});

test("arw, btmh and btih are accepted as written and returned unchanged", () => {
  assert.equal(ARW.length, 43);
  assert.deepEqual(canonicalise(`arw:${ARW}`, "website"), { ok: true, type: "arw", id: `arw:${ARW}` });
  assert.deepEqual(canonicalise(`btmh:${BTMH}`, "website"), { ok: true, type: "btmh", id: `btmh:${BTMH}` });
  assert.deepEqual(canonicalise(`btih:${BTIH}`, "website"), { ok: true, type: "btih", id: `btih:${BTIH}` });
});

test("the vectors in the standard's Identifiers table are accepted", () => {
  for (const id of [
    "arw:7hY2dQxLwq0tZ5Nf_3vKpB8mR1cJ4sEoUaGiTkWnXyA",
    "btmh:12200123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "btih:0123456789abcdef0123456789abcdef01234567",
  ]) {
    assert.equal(canonicalise(id, "website").ok, true, id);
  }
});

// The refusals mirror Orivon's scoreIdOf: another case, length, padding, alphabet or a second colon is not that type.
const BAD: [string, string][] = [
  ["arw too short", `arw:${ARW.slice(1)}`],
  ["arw too long", `arw:${ARW}a`],
  ["arw with +", `arw:${ARW.slice(1)}+`],
  ["arw with /", `arw:${ARW.slice(1)}/`],
  ["arw padded", `arw:${ARW.slice(1)}=`],
  ["arw with a second colon", `arw:${ARW}:x`],
  ["arw doubled prefix", `arw:arw:${ARW}`],
  ["arw empty", "arw:"],
  ["arw upper-case type", `ARW:${ARW}`],
  ["btmh upper-case hex", `btmh:${BTMH.toUpperCase()}`],
  ["btmh upper-case type", `BTMH:${BTMH}`],
  ["btmh without the 1220 prefix", `btmh:${"ab".repeat(32)}`],
  ["btmh with another multihash code", `btmh:1114${"ab".repeat(32)}`],
  ["btmh too short", `btmh:${BTMH.slice(1)}`],
  ["btmh too long", `btmh:${BTMH}0`],
  ["btmh with a non-hex digit", `btmh:1220${"g".repeat(64)}`],
  ["btih upper-case hex", `btih:${BTIH.toUpperCase()}`],
  ["btih mixed case", `btih:A${BTIH.slice(1)}`],
  ["btih too short", `btih:${BTIH.slice(1)}`],
  ["btih too long", `btih:${BTIH}0`],
  ["btih with a non-hex digit", `btih:${"g".repeat(40)}`],
  ["btih with a leading space", `btih: ${BTIH}`],
  ["btih with a trailing newline", `btih:${BTIH}\n`],
  ["btih with a second colon", `btih:${BTIH}:x`],
  ["btih empty", "btih:"],
  ["a btmh value under btih", `btih:${BTMH}`],
  ["a btih value under btmh", `btmh:${BTIH}`],
  ["a bare btih value", BTIH],
];

test("a value that breaks its type's form is refused", () => {
  for (const [label, id] of BAD) assert.equal(canonicalise(id, "website").ok, false, label);
});

test("the message names the type and the form", () => {
  const messages = (id: string) => {
    const r = canonicalise(id, "website");
    return r.ok ? "" : r.message;
  };
  assert.match(messages(`arw:${ARW}a`), /arw .*43/);
  assert.match(messages(`btmh:${BTMH.toUpperCase()}`), /btmh .*lowercase.*1220/);
  assert.match(messages(`btih:${BTIH.toUpperCase()}`), /btih .*lowercase.*40/);
});

test("arw, btmh and btih are website identifiers only", () => {
  for (const id of [`arw:${ARW}`, `btmh:${BTMH}`, `btih:${BTIH}`]) {
    for (const subject of ["operation", "connection"] as const) {
      const r = canonicalise(id, subject);
      assert.equal(r.ok, false, `${id} on a ${subject}`);
      if (!r.ok) assert.match(r.message, /not allowed on a/);
    }
  }
});

test("the existing website types are unchanged", () => {
  assert.deepEqual(canonicalise(`sha256:${"AB".repeat(32)}`, "website"), { ok: true, type: "sha256", id: `sha256:${"ab".repeat(32)}` });
  const cid = "bafybeieqer67ojhi6q3eiatmrcu3r3mqjehn7hwit2satqjfnljo65fb4q";
  assert.deepEqual(canonicalise(`cid:${cid}`, "website"), { ok: true, type: "cid", id: `cid:${cid}` });
});

// The bundle and file hash, and the shapes of the integration identifiers, as the format page's Identifiers table gives them.
const HEX = "ab".repeat(32);

test("an installed integration's connection rating is filed under its bundle hash or cid", () => {
  assert.deepEqual(canonicalise(`sha256:${"AB".repeat(32)}`, "connection"), { ok: true, type: "sha256", id: `sha256:${HEX}` });
  const cid = "bafybeieqer67ojhi6q3eiatmrcu3r3mqjehn7hwit2satqjfnljo65fb4q";
  assert.deepEqual(canonicalise(`cid:${cid}`, "connection"), { ok: true, type: "cid", id: `cid:${cid}` });
  assert.equal(canonicalise("sha256:abc", "connection").ok, false);
  assert.equal(canonicalise("cid:not-a-cid", "connection").ok, false);
  assert.equal(canonicalise("origin:https://api.example.com", "connection").ok, true);
});

test("integration identifiers: bundle form, file form, built-in row and declaration form", () => {
  for (const id of [
    `integration:${HEX}#swap-quotes`,
    `integration:${HEX}#a.b_c-d`,
    `integration:${HEX}#${"x".repeat(64)}`,
    "integration:builtin:ethfs",
    "integration:builtin:btc-swap-refund-testnet",
    `integration:decl:${HEX}`,
  ]) {
    assert.deepEqual(canonicalise(id, "integration"), { ok: true, type: "integration", id }, id);
  }
  assert.deepEqual(canonicalise(`sha256:${"AB".repeat(32)}`, "integration"), { ok: true, type: "sha256", id: `sha256:${HEX}` });
});

// The refusals are the cases src/trust/tests/integration-subject.test.ts of Orivon refuses, plus the declaration form.
const BAD_INTEGRATION: [string, string][] = [
  ["no declaration id", `integration:${HEX}`],
  ["an empty declaration id", `integration:${HEX}#`],
  ["a capital in the declaration id", `integration:${HEX}#Swap`],
  ["a declaration id past 64 characters", `integration:${HEX}#${"x".repeat(65)}`],
  ["a second #", `integration:${HEX}#a#b`],
  ["a leading hyphen", `integration:${HEX}#-a`],
  ["a leading dot", `integration:${HEX}#.a`],
  ["a space", `integration:${HEX}#a b`],
  ["a slash", `integration:${HEX}#a/b`],
  ["the sha256 prefix kept in the bundle form", `integration:sha256:${HEX}#swap`],
  ["capital hex", `integration:${"AB".repeat(32)}#swap`],
  ["63 hex digits", `integration:${HEX.slice(1)}#swap`],
  ["65 hex digits", `integration:${HEX}a#swap`],
  ["a built-in with no name", "integration:builtin:"],
  ["a built-in with a capital", "integration:builtin:Ethfs"],
  ["a built-in with a second colon", "integration:builtin:eth:fs"],
  ["a built-in with a #", `integration:builtin:${HEX}#x`],
  ["a built-in name past 64 characters", `integration:builtin:${"x".repeat(65)}`],
  ["a declaration hash in capitals", `integration:decl:${"AB".repeat(32)}`],
  ["a declaration hash of 63 digits", `integration:decl:${HEX.slice(1)}`],
  ["an upper-case type", `Integration:${HEX}#swap`],
  ["no type", `${HEX}#swap`],
  ["a trailing space", "integration:builtin:ethfs "],
];

test("a value that breaks an integration identifier's form is refused", () => {
  for (const [label, id] of BAD_INTEGRATION) assert.equal(canonicalise(id, "integration").ok, false, label);
});

test("integration identifiers are for the integration subject only", () => {
  for (const subject of ["website", "operation", "connection"] as const) {
    const r = canonicalise(`integration:${HEX}#swap`, subject);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /not allowed on a/);
  }
  assert.equal(canonicalise(`arw:${ARW}`, "integration").ok, false);
  assert.equal(canonicalise(`cid:bafybeieqer67ojhi6q3eiatmrcu3r3mqjehn7hwit2satqjfnljo65fb4q`, "integration").ok, false);
});
