import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../../test/support.ts";
import { buildFacts, diffManifests, externalOrigins, htmlTags, loadBuildRecord, manifest, renderFactsMd, saveBuildRecord } from "../facts.ts";
import { link, writeTree } from "./support.ts";

const HTML = `<!doctype html>
<html xmlns="http://www.w3.org/1999/xhtml"><head>
<script src="app.js"></script>
<script src="https://cdn.example.com/lib.js" integrity="sha384-abc" crossorigin></script>
<script src='//track.example.net/t.js'></script>
<link rel="stylesheet" href="https://fonts.example.org/css">
<link rel="icon" href="https://icons.example.org/i.png">
<link rel="modulepreload" href="https://cdn.example.com/m.js">
<link rel="stylesheet" href="local.css">
</head><body><iframe src="https://embed.example.io/x"></iframe><iframe src="inner.html"></iframe></body></html>`;

function build(): string {
  const dir = tempDir();
  writeTree(dir, {
    "index.html": HTML,
    "app.js": 'fetch("https://API.Example.com/v1"); new WebSocket("wss://rpc.example.com:8546/x"); // see http://example.com.',
    "style.css": "@import url(https://fonts.example.org/css);",
    "data.bin": "https://ignored.example.com/in-a-binary",
    "sub/a.json": '{"u":"https://api.example.com/other"}',
  });
  return dir;
}

test("manifest lists regular files sorted with sizes and hashes, and skips symlinks", () => {
  const dir = build();
  link(path.join(dir, "app.js"), path.join(dir, "alias.js"));
  link(dir, path.join(dir, "loop"));
  const m = manifest(dir);
  assert.deepEqual(m.files.map((f) => f.path), ["app.js", "data.bin", "index.html", "style.css", "sub/a.json"]);
  assert.equal(m.truncated, false);
  assert.match(m.files[0]!.sha256!, /^[0-9a-f]{64}$/);
  assert.equal(m.files[0]!.size, Buffer.byteLength('fetch("https://API.Example.com/v1"); new WebSocket("wss://rpc.example.com:8546/x"); // see http://example.com.'));
});

test("diffManifests reports added, removed and changed paths", () => {
  const a = [
    { path: "keep", size: 1, sha256: "1" },
    { path: "gone", size: 1, sha256: "2" },
    { path: "edit", size: 1, sha256: "3" },
    { path: "big", size: 100, sha256: null },
  ];
  const b = [
    { path: "keep", size: 1, sha256: "1" },
    { path: "new", size: 1, sha256: "4" },
    { path: "edit", size: 2, sha256: "5" },
    { path: "big", size: 101, sha256: null },
  ];
  assert.deepEqual(diffManifests(a, b), { added: ["new"], removed: ["gone"], changed: ["edit", "big"] });
});

test("externalOrigins counts files per lowercase origin, in text files only", () => {
  const found = externalOrigins(build());
  assert.deepEqual(found, [
    { origin: "http://example.com", files: 1 },
    { origin: "https://api.example.com", files: 2 },
    { origin: "https://cdn.example.com", files: 1 },
    { origin: "https://embed.example.io", files: 1 },
    { origin: "https://fonts.example.org", files: 2 },
    { origin: "https://icons.example.org", files: 1 },
    { origin: "wss://rpc.example.com:8546", files: 1 },
  ]);
});

test("htmlTags lists scripts, stylesheets and frames that leave the origin, with integrity", () => {
  const tags = htmlTags(build());
  assert.deepEqual(
    tags.map((t) => [t.tag, t.url, t.integrity]),
    [
      ["script", "https://cdn.example.com/lib.js", true],
      ["script", "//track.example.net/t.js", false],
      ["link", "https://fonts.example.org/css", false],
      ["link", "https://cdn.example.com/m.js", false],
      ["iframe", "https://embed.example.io/x", false],
    ],
  );
});

test("buildFacts compares against the fetched previous build, else the kept record, else nothing", () => {
  const next = build();
  const prev = tempDir();
  writeTree(prev, { "index.html": HTML, "app.js": "old", "gone.txt": "x" });
  const withDir = buildFacts({ cid: "bafynew", siteDir: next, previousCid: "bafyold", previousDir: prev, previousRecord: null, savedAt: "t" });
  assert.equal(withDir.facts.comparedAgainst, "the fetched previous build");
  assert.deepEqual(withDir.facts.diff?.removed, ["gone.txt"]);
  assert.ok(withDir.facts.diff?.changed.includes("app.js"));
  assert.equal(withDir.facts.origins.find((o) => o.origin === "https://api.example.com")?.newSincePrevious, true);

  const cached = buildFacts({ cid: "bafyold2", siteDir: next, previousCid: "bafynew", previousDir: null, previousRecord: withDir.record, savedAt: "t" });
  assert.equal(cached.facts.comparedAgainst, "the facts kept from the previous build");
  assert.deepEqual(cached.facts.diff, { added: [], removed: [], changed: [] });
  assert.ok(cached.facts.origins.every((o) => o.newSincePrevious === false));

  const none = buildFacts({ cid: "bafynew", siteDir: next, previousCid: null, previousDir: null, previousRecord: null, savedAt: "t" });
  assert.equal(none.facts.comparedAgainst, "nothing");
  assert.equal(none.facts.diff, null);
  assert.match(renderFactsMd(none.facts), /Compared against: nothing/);
  assert.match(renderFactsMd(withDir.facts), /Compared against: the fetched previous build \(bafyold\)/);
});

test("facts.md caps each list at 200 lines and says how many were left out", () => {
  const dir = tempDir();
  const files: Record<string, string> = {};
  for (let i = 0; i < 230; i++) files[`f${String(i).padStart(3, "0")}.txt`] = String(i);
  writeTree(dir, files);
  const { facts } = buildFacts({ cid: "bafy", siteDir: dir, previousCid: "p", previousDir: tempDir(), previousRecord: null, savedAt: "t" });
  const md = renderFactsMd(facts);
  assert.match(md, /Files added \(230\)/);
  assert.match(md, /\.\.\. and 30 more not listed/);
  assert.equal(md.split("\n").filter((l) => l.startsWith("- f")).length, 200);
});

test("build records round-trip and refuse a name that is not a CID", () => {
  const state = tempDir();
  const { record } = buildFacts({ cid: "bafyrecord1234", siteDir: build(), previousCid: null, previousDir: null, previousRecord: null, savedAt: "t" });
  saveBuildRecord(state, record);
  assert.deepEqual(loadBuildRecord(state, "bafyrecord1234"), record);
  assert.equal(loadBuildRecord(state, "../state"), null);
  assert.throws(() => saveBuildRecord(state, { ...record, cid: "../x" }));
});
