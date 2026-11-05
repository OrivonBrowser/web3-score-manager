import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { compileProvider, writeSite } from "../src/build.ts";
import { bucketOf } from "../src/bucket.ts";
import { main } from "../src/commands.ts";
import { integrationIdOf, integrationIds } from "../src/integration-ids.ts";
import { newEvaluation, newMarks } from "../src/manage.ts";
import { loadProvider } from "../src/source.ts";
import { validateSource } from "../src/validate.ts";
import { SHA_A, makeProvider, tempDir, writeJson } from "./support.ts";

const HEX = "ab".repeat(32);
const BUNDLE = `sha256:${HEX}`;

const integration = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  subject: "integration",
  ids: [`integration:${HEX}#swap-quotes`],
  name: "Swap quotes",
  evaluated: "2026-11-05",
  trustlessity: { level: 3, privacy: false },
  ...extra,
});

const MARKS = {
  standard: "orivon-web3-score/1",
  subject: "marks",
  updated: "2026-11-05",
  marks: [
    { id: "audited", label: "Audited", tone: "#2563eb", ink: { light: "#1e3a8a", dark: "#bfdbfe" } },
    { id: "web3", label: "Web3", tone: "#16a34a", ink: { light: "#14532d", dark: "#bbf7d0" }, restyles: "web3" },
  ],
};

const paths = (value: unknown, dir?: "integration" | "website") => validateSource(value, "f.json", dir).issues.map((i) => i.path);

async function cli(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const code = await main(argv, { out: (t) => void (out += t), err: (t) => void (err += t) });
  return { code, out, err };
}

test("an integration evaluation is on the website scale, with privacy at Level 4", () => {
  assert.deepEqual(paths(integration(), "integration"), []);
  for (const level of [1, 2, 3, 4]) assert.deepEqual(paths(integration({ trustlessity: { level } })), []);
  assert.deepEqual(paths(integration({ trustlessity: { level: 5 } })), ["trustlessity.level"]);
  assert.deepEqual(paths(integration({ trustlessity: { level: 0 } })), ["trustlessity.level"]);
  assert.deepEqual(paths(integration({ trustlessity: { level: 4, privacy: true } })), []);
  assert.deepEqual(paths(integration({ trustlessity: { level: 3, privacy: true } })), ["trustlessity.privacy"]);
});

test("an integration is filed under integration: and sha256: identifiers, and under no other type", () => {
  assert.deepEqual(paths(integration({ ids: [`integration:${HEX}#a`, "integration:builtin:ethfs", `integration:decl:${HEX}`, BUNDLE] })), []);
  assert.deepEqual(paths(integration({ ids: ["cid:bafybeieqer67ojhi6q3eiatmrcu3r3mqjehn7hwit2satqjfnljo65fb4q"] })), ["ids[0]"]);
  assert.deepEqual(paths(integration({ ids: [`integration:${HEX}#Bad`] })), ["ids[0]"]);
  assert.deepEqual(paths(integration({ ids: [`integration:${HEX}#a`, `integration:${HEX}#a`] })), ["ids[1]"]);
  assert.deepEqual(paths({ ...integration(), subject: "website" }, "website"), ["ids[0]"]);
});

test("an integration is judged as a whole: no names, operations or connections", () => {
  const part = { name: "p", trustlessity: { level: 1 } };
  assert.deepEqual(paths(integration({ names: ["a.eth"] })), ["names"]);
  assert.deepEqual(paths(integration({ operations: [part] })), ["operations"]);
  assert.deepEqual(paths(integration({ connections: [part] })), ["connections"]);
});

test("the subject must be the directory the file is in", () => {
  assert.deepEqual(paths(integration(), "website"), ["subject"]);
});

test("warnings: at most 8 entries of a known kind and a plain note", () => {
  const warned = (warnings: unknown) => paths(integration({ warnings }));
  assert.deepEqual(warned([{ kind: "phishing", note: "Copies the login page of another wallet." }, { kind: "other" }]), []);
  for (const kind of ["phishing", "drainer", "malware", "web2", "other"]) assert.deepEqual(warned([{ kind }]), [], kind);
  assert.deepEqual(warned([{ kind: "scam" }]), ["warnings[0].kind"]);
  assert.deepEqual(warned([{}]), ["warnings[0].kind"]);
  assert.deepEqual(warned([{ kind: "other", note: "x".repeat(301) }]), ["warnings[0].note"]);
  assert.deepEqual(warned([{ kind: "other", note: "x".repeat(300) }]), []);
  assert.deepEqual(warned([{ kind: "other", note: "bad ‮ note" }]), ["warnings[0].note"]);
  assert.deepEqual(warned([{ kind: "other", note: "two\nlines" }]), ["warnings[0].note"]);
  assert.deepEqual(warned([{ kind: "other", extra: 1 }]), ["warnings[0].extra"]);
  assert.deepEqual(warned(Array.from({ length: 8 }, () => ({ kind: "other" }))), []);
  assert.deepEqual(warned(Array.from({ length: 9 }, () => ({ kind: "other" }))), ["warnings"]);
  assert.deepEqual(warned([]), ["warnings"]);
  assert.deepEqual(warned("phishing"), ["warnings"]);
  assert.deepEqual(warned(["phishing"]), ["warnings[0]"]);
});

test("security: a level from 1 to 4 and a plain note", () => {
  const secured = (security: unknown) => paths(integration({ security }));
  assert.deepEqual(secured({ level: 2, note: "An admin key can change the contracts." }), []);
  for (const level of [1, 2, 3, 4]) assert.deepEqual(secured({ level }), []);
  for (const level of [0, 5, 2.5, "2", undefined]) assert.deepEqual(secured({ level }), ["security.level"], String(level));
  assert.deepEqual(secured({ level: 2, note: "x".repeat(301) }), ["security.note"]);
  assert.deepEqual(secured({ level: 2, extra: true }), ["security.extra"]);
  assert.deepEqual(secured(2), ["security"]);
  assert.deepEqual(secured([]), ["security"]);
});

test("a mark is the id of one of the provider's marks", () => {
  assert.deepEqual(paths(integration({ mark: "audited" })), []);
  for (const mark of ["Audited", "", "1a", "a".repeat(25), 3, null]) assert.deepEqual(paths(integration({ mark })), ["mark"], String(mark));
});

test("warnings, security and a mark are for a website or an integration only", () => {
  const connection = { subject: "connection", ids: ["caip2:eip155:1"], name: "C", evaluated: "2026-11-05", trustlessity: { level: 1 } };
  assert.deepEqual(paths({ ...connection, warnings: [{ kind: "other" }] }), ["warnings"]);
  assert.deepEqual(paths({ ...connection, security: { level: 1 } }), ["security"]);
  assert.deepEqual(paths({ ...connection, mark: "audited" }), ["mark"]);
  const site = { subject: "website", ids: [BUNDLE], name: "W", evaluated: "2026-11-05", trustlessity: { level: 3 } };
  assert.deepEqual(paths({ ...site, warnings: [{ kind: "drainer" }], security: { level: 3 }, mark: "audited" }), []);
});

test("the built bucket carries warnings, security and the mark of an integration, in the standard's fields", () => {
  const id = `integration:${HEX}#swap-quotes`;
  const dir = makeProvider([["integration", "swap-quotes", integration({ warnings: [{ kind: "malware", note: "Drops a binary." }], security: { level: 2 }, mark: "audited" })]]);
  writeJson(path.join(dir, "marks.json"), MARKS);
  const out = path.join(tempDir(), "dist");
  writeSite(out, compileProvider(dir));
  const bucket = bucketOf(id, 2);
  const file = JSON.parse(readFileSync(path.join(out, "score", "integration", `${bucket}.json`), "utf8"));
  assert.deepEqual(file, {
    standard: "orivon-web3-score/1",
    subject: "integration",
    bucket,
    entries: [
      {
        id,
        name: "Swap quotes",
        evaluated: "2026-11-05",
        trustlessity: { level: 3, privacy: false },
        warnings: [{ kind: "malware", note: "Drops a binary." }],
        security: { level: 2 },
        mark: "audited",
      },
    ],
  });
});

test("the documented test vectors land in the documented buckets", () => {
  assert.equal(bucketOf("integration:26054c511f3394b66c6a022a48d82e559d637ac4b111657482ec6b7a7447fbcf#swap-quotes", 2), "4f");
  assert.equal(bucketOf("integration:builtin:ethfs", 2), "17");
  assert.equal(bucketOf("integration:decl:26054c511f3394b66c6a022a48d82e559d637ac4b111657482ec6b7a7447fbcf", 2), "43");
  assert.equal(bucketOf("integration:decl:26054c511f3394b66c6a022a48d82e559d637ac4b111657482ec6b7a7447fbcf", 8), "43134bb4");
  assert.equal(bucketOf("integration:builtin:ethfs", 8), "178c8cf0");
  assert.equal(bucketOf("integration:26054c511f3394b66c6a022a48d82e559d637ac4b111657482ec6b7a7447fbcf#swap-quotes", 8), "4fb50266");
});

test("marks.json is validated by check and published as score/marks.json", () => {
  const dir = makeProvider([["website", "a", { subject: "website", ids: [SHA_A], name: "A", evaluated: "2026-11-05", trustlessity: { level: 1 } }]]);
  assert.equal(loadProvider(dir).marks, undefined);
  writeJson(path.join(dir, "marks.json"), MARKS);
  const loaded = loadProvider(dir);
  assert.deepEqual(loaded.issues, []);
  assert.equal(loaded.marks?.marks.length, 2);
  const files = compileProvider(dir);
  assert.deepEqual(JSON.parse(files.get("score/marks.json")!), MARKS);
  assert.match(files.get("index.html")!, /Marks/);
  assert.match(files.get("index.html")!, /style="background:#2563eb"/);

  writeJson(path.join(dir, "marks.json"), { ...MARKS, marks: [{ ...MARKS.marks[0], tone: "blue" }] });
  assert.ok(loadProvider(dir).issues.some((i) => i.file.endsWith("marks.json") && i.path === "marks[0].tone"));
  assert.throws(() => compileProvider(dir), /marks\.json: marks\[0\]\.tone/);
});

test("a provider with no marks.json publishes no score/marks.json", () => {
  const dir = makeProvider([["integration", "a", integration()]]);
  assert.ok(!compileProvider(dir).has("score/marks.json"));
});

test("an evaluation may name only a mark the provider holds, and not a restyle", () => {
  const issues = (marks: unknown, mark: string) => {
    const dir = makeProvider([["integration", "a", integration({ mark })]]);
    if (marks !== undefined) writeJson(path.join(dir, "marks.json"), marks);
    return loadProvider(dir).issues.map((i) => `${path.basename(i.file)}: ${i.path}: ${i.message}`);
  };
  assert.deepEqual(issues(MARKS, "audited"), []);
  assert.match(issues(MARKS, "missing").join("\n"), /a\.json: mark: names "missing", which marks\.json does not hold/);
  assert.match(issues(undefined, "audited").join("\n"), /a\.json: mark: names "audited", but the provider has no marks\.json/);
  assert.match(issues(MARKS, "web3").join("\n"), /a\.json: mark: names "web3", which restyles web3/);
});

test("a broken marks.json does not also report every mark an evaluation names", () => {
  const dir = makeProvider([["integration", "a", integration({ mark: "audited" })]]);
  writeJson(path.join(dir, "marks.json"), { ...MARKS, updated: "later" });
  assert.deepEqual(loadProvider(dir).issues.map((i) => i.path), ["updated"]);
});

test("new integration and new marks write files check accepts once the placeholder is replaced", async () => {
  const dir = path.join(tempDir(), "p");
  assert.equal((await cli("init", "--dir", dir, "--name", "P")).code, 0);
  assert.equal((await cli("new", "integration", "swap", "--dir", dir, "--id", `integration:${HEX}#swap-quotes`)).code, 0);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "scores", "integration", "swap.json"), "utf8")).ids, [`integration:${HEX}#swap-quotes`]);
  const placeholder = newEvaluation(dir, "integration", "todo", []);
  assert.match(readFileSync(placeholder, "utf8"), /integration:<64 hex characters of the bundle hash>#<declaration id>/);
  assert.ok(loadProvider(dir).issues.some((i) => i.file === placeholder));

  assert.equal((await cli("new", "marks", "--dir", dir)).code, 0);
  assert.ok(existsSync(path.join(dir, "marks.json")));
  assert.throws(() => newMarks(dir), /already exists/);
  const marks = JSON.parse(readFileSync(path.join(dir, "marks.json"), "utf8"));
  assert.equal(marks.marks.length, 1);
  assert.equal(marks.marks[0].restyles, undefined);
  assert.deepEqual(loadProvider(dir).issues.filter((i) => i.file.endsWith("marks.json")), []);
});

const declaration = (extra: Record<string, unknown>): Record<string, unknown> => ({ id: "thing", name: "Thing", ...extra });

test("an integration that brings files is filed under the site's bundle and its declaration id", () => {
  assert.equal(integrationIdOf(declaration({ type: "account", entry: "host.html" }), BUNDLE), `integration:${HEX}#thing`);
  assert.equal(integrationIdOf(declaration({ type: "payment", hosting: "component", module: "pay.wasm", hash: "cd".repeat(32) }), BUNDLE), `integration:${HEX}#thing`);
  assert.equal(integrationIdOf(declaration({ type: "standard", module: "std.json", hash: "cd".repeat(32) }), BUNDLE), `integration:${HEX}#thing`);
});

test("a library or an extension is filed under the SHA-256 of its own file", () => {
  assert.equal(integrationIdOf(declaration({ type: "library", library: "lib.add@1.0.0", module: "add.wasm", hash: "cd".repeat(32) }), BUNDLE), `sha256:${"cd".repeat(32)}`);
  assert.equal(integrationIdOf(declaration({ type: "extension", crx: "x.crx", hash: "cd".repeat(32) }), BUNDLE), `sha256:${"cd".repeat(32)}`);
  assert.throws(() => integrationIdOf(declaration({ type: "library", module: "add.wasm", hash: "CD".repeat(32) }), BUNDLE), /64 lowercase hex/);
  assert.throws(() => integrationIdOf(declaration({ type: "extension", crx: "x.crx" }), BUNDLE), /64 lowercase hex/);
});

test("a data-only integration is filed under the SHA-256 of its canonical declaration, key order and whitespace aside", () => {
  const one = integrationIdOf({ type: "search", id: "mine", name: "Mine", url: "https://s.example/?q=%s" }, BUNDLE);
  const two = integrationIdOf({ url: "https://s.example/?q=%s", name: "Mine", id: "mine", type: "search" }, BUNDLE);
  assert.match(one, /^integration:decl:[0-9a-f]{64}$/);
  assert.equal(one, two);
  assert.notEqual(one, integrationIdOf({ type: "search", id: "mine", name: "Mine", url: "https://s.example/?query=%s" }, BUNDLE));
  assert.throws(() => integrationIdOf({ type: "search", name: "No id" }, BUNDLE), /declares no id/);
});

test("ids --integrations lists the identifier of each integration a built static app declares", async () => {
  const dir = tempDir();
  writeJson(path.join(dir, ".well-known", "orivon-ddoc.json"), { bundleHash: BUNDLE });
  writeJson(path.join(dir, ".well-known", "orivon.json"), {
    orivonApiVersion: 0,
    integrations: [
      { type: "account", id: "ledger", name: "Ledger", entry: "host.html" },
      { type: "library", id: "add", name: "Add", library: "lib.add@1.0.0", module: "add.wasm", hash: "cd".repeat(32) },
      { type: "search", id: "mine", name: "Mine", url: "https://s.example/?q=%s" },
    ],
  });
  const lines = integrationIds(dir);
  assert.equal(lines.length, 3);
  assert.equal(lines[0], `integration:${HEX}#ledger`);
  assert.equal(lines[1], `sha256:${"cd".repeat(32)}`);
  assert.match(lines[2]!, /^integration:decl:[0-9a-f]{64}$/);

  const listed = await cli("ids", dir, "--integrations");
  assert.equal(listed.code, 0);
  assert.equal(listed.out, `${lines.join("\n")}\n`);
  assert.equal((await cli("ids", dir)).out, `${BUNDLE}\n`);

  const bare = tempDir();
  writeJson(path.join(bare, ".well-known", "orivon-ddoc.json"), { bundleHash: BUNDLE });
  writeJson(path.join(bare, ".well-known", "orivon.json"), { orivonApiVersion: 0 });
  assert.equal((await cli("ids", bare, "--integrations")).code, 1);
});
