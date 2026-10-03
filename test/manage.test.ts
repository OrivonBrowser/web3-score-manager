import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { main } from "../src/commands.ts";
import { addEvaluation, initProvider, listEvaluations, newEvaluation, readBundleHash, removeEvaluation } from "../src/manage.ts";
import { loadProvider } from "../src/source.ts";
import { SHA_A, SHA_B, tempDir, website, writeJson } from "./support.ts";

async function cli(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const code = await main(argv, { out: (t) => void (out += t), err: (t) => void (err += t) });
  return { code, out, err };
}

test("init, new, add, list, remove round trip", () => {
  const dir = path.join(tempDir(), "p");
  initProvider(dir, { name: "My provider", bucketHexChars: 2, about: "https://a.example" });
  assert.throws(() => initProvider(dir, { name: "again", bucketHexChars: 2 }), /already exists/);
  assert.equal(loadProvider(dir).issues.length, 0);

  const file = newEvaluation(dir, "website", "demo", [SHA_A.toUpperCase().replace("SHA256", "sha256")]);
  assert.equal(path.relative(dir, file).split(path.sep).join("/"), "scores/website/demo.json");
  assert.throws(() => newEvaluation(dir, "website", "demo", []), /already exists/);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).ids[0], SHA_A);
  assert.equal(loadProvider(dir).issues.length, 0);

  const source = path.join(tempDir(), "other.json");
  writeJson(source, website({ ids: [SHA_B], name: "Other", trustlessity: { level: 4, privacy: true } }));
  const added = addEvaluation(dir, source, { force: false });
  assert.equal(path.basename(added), "other.json");
  assert.throws(() => addEvaluation(dir, source, { force: false }), /already exists/);
  addEvaluation(dir, source, { force: true });
  assert.throws(() => addEvaluation(dir, source, { slug: "copy", force: false }), /already listed/);

  const { lines, issues } = listEvaluations(dir);
  assert.deepEqual(issues, []);
  assert.equal(lines.length, 2);
  assert.ok(lines.some((l) => l.includes("L4+privacy") && l.includes("Other") && l.includes(SHA_B)));
  assert.ok(lines.some((l) => l.startsWith("website  demo  L1  ")));

  removeEvaluation(dir, "demo");
  assert.ok(!existsSync(file));
  removeEvaluation(dir, SHA_B);
  assert.equal(listEvaluations(dir).lines.length, 0);
  assert.throws(() => removeEvaluation(dir, "demo"), /no evaluation/);
});

test("add rejects an invalid file and writes nothing", () => {
  const dir = path.join(tempDir(), "p");
  initProvider(dir, { name: "P", bucketHexChars: 2 });
  const source = path.join(tempDir(), "bad.json");
  writeJson(source, website({ trustlessity: { level: 9 } }));
  assert.throws(() => addEvaluation(dir, source, { force: false }), /trustlessity.level/);
  assert.equal(listEvaluations(dir).lines.length, 0);
  writeFileSync(source, "{not json");
  assert.throws(() => addEvaluation(dir, source, { force: false }), /invalid JSON/);
});

test("remove reports an ambiguous slug", () => {
  const dir = path.join(tempDir(), "p");
  initProvider(dir, { name: "P", bucketHexChars: 2 });
  writeJson(path.join(dir, "scores", "website", "same.json"), website());
  writeJson(path.join(dir, "scores", "connection", "same.json"), { subject: "connection", ids: ["caip2:eip155:1"], name: "C", evaluated: "2026-10-03", trustlessity: { level: 1 } });
  assert.throws(() => removeEvaluation(dir, "same"), /ambiguous/);
});

test("new refuses a bad subject, slug or identifier", () => {
  const dir = path.join(tempDir(), "p");
  initProvider(dir, { name: "P", bucketHexChars: 2 });
  assert.throws(() => newEvaluation(dir, "planet", "x", []), /subject/);
  assert.throws(() => newEvaluation(dir, "website", "Bad Slug", []), /slug/);
  assert.throws(() => newEvaluation(dir, "website", "x", ["caip2:eip155:1"]), /--id/);
  const file = newEvaluation(dir, "website", "placeholder", []);
  assert.ok(loadProvider(dir).issues.some((i) => i.file === file), "a placeholder id fails check until edited");
});

test("ids reads the bundle hash from the DDOC manifest", () => {
  const dir = tempDir();
  writeJson(path.join(dir, ".well-known", "orivon-ddoc.json"), { bundleHash: SHA_A });
  assert.equal(readBundleHash(dir), SHA_A);
  writeJson(path.join(dir, ".well-known", "orivon-ddoc.json"), { bundleHash: "sha256:xyz" });
  assert.throws(() => readBundleHash(dir), /bundleHash/);
  assert.throws(() => readBundleHash(tempDir()), /cannot read/);
});

test("the CLI: check, list, build, help and usage errors", async () => {
  const dir = path.join(tempDir(), "p");
  assert.equal((await cli("init", "--dir", dir, "--name", "CLI provider")).code, 0);
  assert.equal((await cli("new", "website", "demo", "--dir", dir, "--id", SHA_A)).code, 0);
  const check = await cli("check", "--dir", dir);
  assert.equal(check.code, 0);
  assert.equal(check.out, "1 evaluations, valid\n");

  const out = path.join(tempDir(), "o");
  assert.equal((await cli("build", "--dir", dir, "--out", out)).code, 0);
  assert.ok(existsSync(path.join(out, "score", "provider.json")));

  writeJson(path.join(dir, "scores", "website", "demo.json"), website({ evaluated: "bad" }));
  const failed = await cli("check", "--dir", dir);
  assert.equal(failed.code, 1);
  assert.match(failed.err, /demo\.json: evaluated: must be a real date/);
  assert.equal((await cli("build", "--dir", dir, "--out", path.join(tempDir(), "x"))).code, 1);

  assert.equal((await cli("bogus")).code, 2);
  assert.equal((await cli()).code, 2);
  assert.equal((await cli("check", "--nope")).code, 2);
  assert.equal((await cli("check", "--help")).code, 0);
  assert.equal((await cli("--help")).code, 0);
});
