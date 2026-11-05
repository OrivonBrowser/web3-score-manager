import assert from "node:assert/strict";
import { test } from "node:test";
import { compileProvider } from "../src/build.ts";
import { loadProvider } from "../src/source.ts";

// Orivon Attila, the provider in provider/, judged by the rules in provider/README.md.
const attila = loadProvider(new URL("../provider", import.meta.url).pathname);

test("Orivon Attila's evaluations are valid", () => {
  assert.deepEqual(attila.issues, []);
});

// A score counts only at the names its evaluation lists, so a website that is served at a name
// carries it into the bucket.
test("the compiled buckets carry the names of the evaluations that list them", () => {
  const files = compileProvider(new URL("../provider", import.meta.url).pathname);
  const entries = [...files]
    .filter(([file]) => /^score\/website\/[0-9a-f]+\.json$/.test(file))
    .flatMap(([, text]) => (JSON.parse(text) as { entries: { id: string; names?: string[] }[] }).entries);
  assert.ok(entries.length > 0);
  const listing = attila.evaluations.filter(({ subject, evaluation }) => subject === "website" && evaluation.names !== undefined);
  assert.ok(listing.length > 0);
  for (const { evaluation, file } of listing) {
    for (const id of evaluation.ids) {
      assert.deepEqual(entries.find((e) => e.id === id)?.names, evaluation.names, `${file}: ${id}`);
    }
  }
  const webtorrent = attila.evaluations.find(({ file }) => file.endsWith("webtorrent.json"));
  assert.deepEqual(webtorrent?.evaluation.names, ["webtorrent.orivonstack.eth"]);
});

// Level 3 starts with public source (provider/README.md): a judge who cannot point at it has
// not established it. A page served as written cites its own address.
test("every website Attila judges 3 or 4 cites its public source in evidence and says why", () => {
  for (const { subject, evaluation, file } of attila.evaluations) {
    if (subject !== "website" || evaluation.trustlessity.level < 3) continue;
    assert.ok((evaluation.evidence ?? []).length > 0, `${file}: Level ${evaluation.trustlessity.level} with no evidence`);
    assert.ok((evaluation.summary ?? "").length > 0, `${file}: no summary`);
  }
});

const integrations = attila.evaluations.filter(({ subject }) => subject === "integration");

// An integration is judged by the rules in provider/README.md (How Attila judges an integration): Level 3 and
// 4 need public source, and a judge who cannot point at it has not established it.
test("every integration Attila judges 3 or 4 cites evidence and says why", () => {
  assert.ok(integrations.length > 0);
  for (const { evaluation, file } of integrations) {
    if (evaluation.trustlessity.level < 3) continue;
    assert.ok((evaluation.evidence ?? []).length > 0, `${file}: Level ${evaluation.trustlessity.level} with no evidence`);
    assert.ok((evaluation.summary ?? "").length > 0, `${file}: no summary`);
  }
});

test("an integration Orivon ships is judged under its row's identifier and says its publisher judged it", () => {
  const builtins = integrations.filter(({ evaluation }) => evaluation.ids.some((id) => id.startsWith("integration:builtin:")));
  assert.ok(builtins.length >= 50);
  for (const { evaluation, file } of builtins) {
    assert.match(evaluation.summary ?? "", /Judged here by its publisher\.$/, file);
  }
  const named = new Set(builtins.flatMap(({ evaluation }) => evaluation.ids));
  for (const row of ["ipfs-node", "swarm-node", "helios", "ens", "nym", "socks5", "load-owner", "load-https", "newtab", "ublock", "attila", "direct-transfer", "uniswap", "orivon-mnemonic", "sqlite3"]) {
    assert.ok(named.has(`integration:builtin:${row}`), `no verdict for the built-in ${row}`);
  }
});

test("an integration is filed under one identifier in one verdict, and no id is filed twice", () => {
  const seen = new Map<string, string>();
  for (const { evaluation, file } of integrations) {
    for (const id of evaluation.ids) {
      assert.equal(seen.get(id), undefined, `${id} is filed by ${seen.get(id)} and ${file}`);
      seen.set(id, file);
    }
  }
});

// The fixtures Orivon's own tests serve as libraries are filed by the hash of their file.
test("Attila judges the library fixtures Orivon's tests use, by file hash", () => {
  const ids = new Set(integrations.flatMap(({ evaluation }) => evaluation.ids));
  assert.ok(ids.has("sha256:f61fd62f57c41269c3c23f360eeaf1090b1db9c38651106674d48bc65dba88ba"));
  assert.ok(ids.has("sha256:562e74cfe438e3b2691f397619f87ca76d9f22f558e4f9eb3f81f606238f7d31"));
});

test("the compiled buckets carry the integration verdicts at the bucket of their identifier", () => {
  const files = compileProvider(new URL("../provider", import.meta.url).pathname);
  const found = [...files].filter(([file]) => /^score\/integration\/[0-9a-f]+\.json$/.test(file));
  assert.ok(found.length > 0);
  const entries = found.flatMap(([, text]) => (JSON.parse(text) as { entries: { id: string }[] }).entries);
  const filed = integrations.reduce((count, { evaluation }) => count + evaluation.ids.length, 0);
  assert.equal(entries.length, filed);
  assert.ok(entries.some((entry) => entry.id === "integration:builtin:ipfs-node"));
});
