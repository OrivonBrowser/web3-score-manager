import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { compileProvider, writeSite } from "../src/build.ts";
import { bucketOf } from "../src/bucket.ts";
import { SHA_A, SHA_B, makeProvider, tempDir, website } from "./support.ts";

function tree(root: string, rel = ""): string[] {
  return readdirSync(path.join(root, rel), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? tree(root, path.join(rel, e.name)) : [path.join(rel, e.name).split(path.sep).join("/")]))
    .sort();
}

const read = (root: string, rel: string) => readFileSync(path.join(root, ...rel.split("/")), "utf8");

test("example provider builds the three expected buckets", () => {
  const out = path.join(tempDir(), "dist");
  writeSite(out, compileProvider("examples/orivon-test-provider"));
  assert.deepEqual(tree(out), [
    "index.html",
    "score/index.html",
    "score/provider.json",
    "score/website/4c.json",
    "score/website/c6.json",
    "score/website/da.json",
  ]);
  const lounge = JSON.parse(read(out, "score/website/c6.json"));
  assert.equal(lounge.entries[0].id, "cid:bafybeieqer67ojhi6q3eiatmrcu3r3mqjehn7hwit2satqjfnljo65fb4q");
  assert.equal(lounge.entries[0].name, "The Lounge");
  assert.equal(JSON.parse(read(out, "score/provider.json")).bucketHexChars, 2);
});

test("output is byte-for-byte identical across builds and has no source-only fields", () => {
  const dir = makeProvider([["website", "a", website({ ids: [SHA_A, SHA_B] })]]);
  const first = path.join(tempDir(), "o");
  const second = path.join(tempDir(), "o");
  writeSite(first, compileProvider(dir));
  writeSite(second, compileProvider(dir));
  assert.deepEqual(tree(first), tree(second));
  for (const file of tree(first)) assert.equal(read(first, file), read(second, file), file);
  const bucket = JSON.parse(read(first, `score/website/${bucketOf(SHA_A, 2)}.json`));
  for (const entry of bucket.entries) {
    assert.equal(entry.ids, undefined);
    assert.equal(entry.subject, undefined);
    assert.ok(typeof entry.id === "string");
  }
  assert.ok(read(first, "score/provider.json").endsWith("}\n"));
});

test("an evaluation with N ids yields N entries, sorted by id, in the right buckets", () => {
  const ids = [SHA_B, SHA_A, `sha256:${"c".repeat(64)}`];
  const dir = makeProvider([["website", "multi", website({ ids })]], 1);
  const out = path.join(tempDir(), "o");
  writeSite(out, compileProvider(dir));
  const seen: string[] = [];
  for (const file of tree(out).filter((f) => /^score\/website\/.\.json$/.test(f))) {
    const bucket = JSON.parse(read(out, file));
    assert.equal(file, `score/website/${bucket.bucket}.json`);
    assert.equal(bucket.standard, "orivon-web3-score/1");
    assert.equal(bucket.subject, "website");
    const sorted = bucket.entries.map((e: { id: string }) => e.id);
    assert.deepEqual(sorted, [...sorted].sort());
    for (const id of sorted) assert.equal(bucketOf(id, 1), bucket.bucket);
    seen.push(...sorted);
  }
  assert.deepEqual(seen.sort(), [...ids].sort());
});

test("two evaluations in one bucket share a file; empty buckets are absent", () => {
  const dir = makeProvider([
    ["website", "a", website({ ids: [SHA_A] })],
    ["website", "b", website({ ids: [SHA_B], name: "Other" })],
  ], 1);
  const out = path.join(tempDir(), "o");
  writeSite(out, compileProvider(dir));
  const files = tree(out).filter((f) => f.startsWith("score/website/"));
  assert.ok(files.length <= 2 && files.length >= 1);
  assert.ok(!tree(out).some((f) => f.startsWith("score/operation/")));
});

test("operation and connection evaluations get their own subject directories", () => {
  const dir = makeProvider([
    ["operation", "swap", { subject: "operation", ids: ["caip10:eip155:1:0xab"], name: "Swap", evaluated: "2026-10-03", trustlessity: { level: 4 } }],
    ["connection", "rpc", { subject: "connection", ids: ["origin:https://rpc.example"], name: "RPC", evaluated: "2026-10-03", trustlessity: { level: 2 } }],
  ]);
  const out = path.join(tempDir(), "o");
  writeSite(out, compileProvider(dir));
  const files = tree(out);
  assert.ok(files.includes(`score/operation/${bucketOf("caip10:eip155:1:0xab", 2)}.json`));
  assert.ok(files.includes(`score/connection/${bucketOf("origin:https://rpc.example", 2)}.json`));
});

test("build refuses invalid input with every problem listed", () => {
  const dir = makeProvider([
    ["website", "bad", website({ name: "", trustlessity: { level: 9 } })],
    ["website", "dup1", website({ ids: [SHA_A] })],
    ["website", "dup2", website({ ids: [SHA_A] })],
  ]);
  assert.throws(() => compileProvider(dir), (e: Error) => /name/.test(e.message) && /trustlessity.level/.test(e.message) && /already listed/.test(e.message));
});

test("writeSite replaces a previous build and an empty directory", () => {
  const dir = makeProvider([["website", "a", website()]]);
  const out = path.join(tempDir(), "o");
  writeSite(out, compileProvider(dir));
  writeFileSync(path.join(out, "stale.txt"), "x");
  writeSite(out, compileProvider(dir));
  assert.ok(!tree(out).includes("stale.txt"));
  const empty = tempDir();
  writeSite(empty, compileProvider(dir));
  assert.ok(tree(empty).includes("score/provider.json"));
});

test("writeSite refuses to wipe a directory that is not a previous build", () => {
  const dir = makeProvider([["website", "a", website()]]);
  const other = tempDir();
  writeFileSync(path.join(other, "precious.txt"), "keep");
  assert.throws(() => writeSite(other, compileProvider(dir)), /not a previous build/);
  assert.equal(read(other, "precious.txt"), "keep");
  const file = path.join(tempDir(), "f");
  writeFileSync(file, "x");
  assert.throws(() => writeSite(file, compileProvider(dir)), /not a directory/);
});

test("writeSite refuses an output that contains the provider directory", () => {
  const parent = tempDir();
  const dir = path.join(parent, "provider");
  mkdirSync(path.join(dir, "scores", "website"), { recursive: true });
  writeFileSync(path.join(dir, "provider.json"), JSON.stringify({ standard: "orivon-web3-score/1", name: "T", bucketHexChars: 2 }));
  mkdirSync(path.join(parent, "score"));
  writeFileSync(path.join(parent, "score", "provider.json"), "{}");
  assert.throws(() => writeSite(parent, compileProvider(dir), dir), /contains the provider directory/);
  assert.ok(readdirSync(dir).includes("provider.json"));
});

test("index.html is self-contained, relative and escapes every string", () => {
  const evil = '<script>alert(1)</script>&"\'';
  const dir = makeProvider([
    ["website", "x", website({
      name: evil,
      summary: evil,
      version: evil,
      operations: [{ name: evil, trustlessity: { level: 3, privacy: false }, note: evil }],
      connections: [{ name: "Chain", trustlessity: { level: 2 }, note: "n" }],
      evidence: ["https://e.example/?a=1&b=\"2\""],
      trustlessity: { level: 4, privacy: true },
    })],
  ]);
  const html = compileProvider(dir).get("index.html")!;
  assert.ok(!html.includes("<script"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;&amp;&quot;&#39;"));
  assert.ok(html.includes("prefers-color-scheme:dark"));
  assert.ok(html.includes('name="viewport"'));
  assert.ok(html.includes("Settings &gt; Web3"));
  assert.ok(html.includes("Level 4 of 4"));
  assert.ok(html.includes("+ privacy"));
  assert.ok(html.includes("Trustless operations (Level 4) and connections (Level 2)"));
  assert.ok(html.includes('href="score/provider.json"'));
  assert.ok(!/(src|href)="\/(?!\/)/.test(html), "no root-absolute links");
  assert.ok(!/<link |<script|@import|url\(/.test(html));
  assert.ok(html.includes("a=1&amp;b=&quot;2&quot;"));
  const score = compileProvider(dir).get("score/index.html")!;
  assert.ok(score.includes('href="../index.html"'));
  assert.ok(score.includes("orivon-web3-score/1"));
});
