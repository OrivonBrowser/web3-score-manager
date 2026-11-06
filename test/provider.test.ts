import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
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
  assert.ok(builtins.length >= 80);
  for (const { evaluation, file } of builtins) {
    assert.match(evaluation.summary ?? "", /Judged here by its publisher\.$/, file);
  }
  const named = new Set(builtins.flatMap(({ evaluation }) => evaluation.ids));
  for (const row of ["ipfs-node", "swarm-node", "helios", "ens", "nym", "socks5", "load-owner", "load-https", "newtab", "ublock", "attila", "direct-transfer", "uniswap", "orivon-mnemonic", "sqlite3", "ethfs", "load-ethfs"]) {
    assert.ok(named.has(`integration:builtin:${row}`), `no verdict for the built-in ${row}`);
  }
});

// The standards Orivon ships a built-in row for, by code: its row is `builtin:std-` and the code in lower case.
const STANDARD_CODES = [
  "ACCOUNT_0_1", "ADDRESS_LIST_0_1", "BOLTZ_NET_0_1", "BTC_0_1", "BTC_NET_0_1", "BTC_PRICE_0_1", "CRYPTO_ACCESS_0_1", "CRYPTO_RULES_0_1",
  "DATA_GATHERING_0_1", "ETH_0_1", "ETH_NET_0_1", "ETH_PRICE_0_1", "ETHFS_0_1", "FACILITATOR_0_1", "INTEGRATION_LIST_0_1", "IPFS_0_1",
  "NAMES_0_1", "NOSTR_0_1", "PASSWORD_0_1", "PAY_0_1", "SWARM_0_1", "THORNODE_NET_0_1", "WEB3_SCORE_0_1", "WIDGETS_0_1",
];

test("every standard Orivon ships a built-in row for is judged under its row's lower-case identifier, as a definition", () => {
  const byId = new Map(integrations.flatMap(({ evaluation }) => evaluation.ids.map((id) => [id, evaluation] as const)));
  for (const code of STANDARD_CODES) {
    const evaluation = byId.get(`integration:builtin:std-${code.toLowerCase()}`);
    assert.ok(evaluation, `no verdict for the standard ${code}`);
    assert.deepEqual(evaluation.trustlessity, { level: 4, privacy: true }, code);
    assert.ok((evaluation.name ?? "").includes(code), code);
  }
  const rows = [...byId.keys()].filter((id) => id.startsWith("integration:builtin:std-"));
  assert.equal(rows.length, STANDARD_CODES.length, "a standard row is judged that Orivon does not ship");
});

// Every built-in row Orivon declares has a verdict here, read off an Orivon checkout when ORIVON_REPO names one (its root):
// the standards it defines, the sources of Load sites from, and each row its built-ins source files name.
const orivon = process.env.ORIVON_REPO;
const skipOrivon = orivon !== undefined && existsSync(path.join(orivon, "src", "standards", "official")) ? false : "set ORIVON_REPO to an Orivon checkout to read its built-in rows";

test("every built-in row Orivon declares is judged", { skip: skipOrivon }, () => {
  const root = orivon ?? "";
  const rows = new Set<string>();
  const official = path.join(root, "src", "standards", "official");
  for (const file of readdirSync(official).filter((name) => name.endsWith(".json"))) {
    rows.add(`builtin:std-${(JSON.parse(readFileSync(path.join(official, file), "utf8")) as { code: string }).code.toLowerCase()}`);
  }
  const order = readFileSync(path.join(root, "src", "protocols", "resolution", "load-order.ts"), "utf8");
  const table = /BUILTIN_ROWS[^=]*= \[([^\]]*)\]/.exec(order)?.[1] ?? "";
  for (const [, id] of table.matchAll(/id: '([a-z0-9-]+)'/g)) rows.add(`builtin:load-${id}`);
  const sources = path.join(root, "src", "main", "integrations", "builtins");
  for (const file of readdirSync(sources).filter((name) => name.endsWith(".ts"))) {
    // A name that ends in "-" is the start of rows made at run time, and each of those is a row of its own.
    for (const [, id] of readFileSync(path.join(sources, file), "utf8").matchAll(/'(builtin:[a-z0-9-]*[a-z0-9])'/g)) rows.add(id as string);
  }
  assert.ok(rows.size > 70, `read only ${rows.size} rows`);
  const judged = new Set(integrations.flatMap(({ evaluation }) => evaluation.ids));
  assert.deepEqual([...rows].filter((row) => !judged.has(`integration:${row}`)).sort(), []);
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
