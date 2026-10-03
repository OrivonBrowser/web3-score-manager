import assert from "node:assert/strict";
import { request } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, test } from "node:test";
import { compileProvider, writeSite } from "../src/build.ts";
import { resolveTarget, startServer } from "../src/serve.ts";
import { tempDir } from "./support.ts";

let server: Server;
let port: number;

before(async () => {
  const root = path.join(tempDir(), "site");
  writeSite(root, compileProvider("examples/orivon-test-provider"));
  server = await startServer(root, 0, "127.0.0.1");
  port = (server.address() as AddressInfo).port;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

function raw(method: string, target: string): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path: target }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("serves provider.json as JSON with CORS and no caching", async () => {
  const res = await raw("GET", "/score/provider.json");
  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(res.headers["access-control-allow-origin"], "*");
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(JSON.parse(res.body).standard, "orivon-web3-score/1");
});

test("serves a bucket and answers 404 for a bucket with nothing", async () => {
  const hit = await raw("GET", "/score/website/4c.json");
  assert.equal(hit.status, 200);
  const bucket = JSON.parse(hit.body);
  assert.equal(bucket.bucket, "4c");
  assert.equal(bucket.entries[0].name, "ASGARDEX");
  assert.equal((await raw("GET", "/score/website/00.json")).status, 404);
});

test("directory requests serve index.html; a bare directory redirects with a slash", async () => {
  const root = await raw("GET", "/");
  assert.equal(root.status, 200);
  assert.equal(root.headers["content-type"], "text/html; charset=utf-8");
  assert.ok(root.body.includes("Orivon test provider"));
  assert.equal((await raw("GET", "/score/")).status, 200);
  const redirect = await raw("GET", "/score");
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.location, "/score/");
});

test("HEAD has no body; other methods are refused", async () => {
  const head = await raw("HEAD", "/score/provider.json");
  assert.equal(head.status, 200);
  assert.equal(head.body, "");
  assert.equal((await raw("POST", "/score/provider.json")).status, 405);
});

test("path traversal never leaves the root", async () => {
  const attempts = [
    "/../package.json",
    "/score/../../package.json",
    "/%2e%2e/package.json",
    "/%2e%2e/%2e%2e/etc/passwd",
    "/score/%2e%2e/%2e%2e/package.json",
    "/..%2fpackage.json",
    "/%5c..%5cpackage.json",
    "/..\\package.json",
    "/score/..%5c..%5cpackage.json",
    "/%00",
    "/%zz",
    "/C:/Windows/win.ini",
    "//etc/passwd",
  ];
  for (const target of attempts) {
    const res = await raw("GET", target);
    assert.ok(res.status === 400 || res.status === 404, `${target} answered ${res.status}`);
    assert.ok(!res.body.includes('"name": "web3-score-manager"'), target);
  }
});

test("resolveTarget refuses dot segments, backslashes, NUL and bad escapes", () => {
  assert.deepEqual(resolveTarget("/a/b?x=1#y"), { ok: true, segments: ["a", "b"] });
  assert.deepEqual(resolveTarget("/./a//b/"), { ok: true, segments: ["a", "b"] });
  assert.deepEqual(resolveTarget("/%2e%2e/x"), { ok: false, status: 404 });
  assert.deepEqual(resolveTarget("/a\\b"), { ok: false, status: 400 });
  assert.deepEqual(resolveTarget("/%00"), { ok: false, status: 400 });
  assert.deepEqual(resolveTarget("/%e0%a4%a"), { ok: false, status: 400 });
  assert.deepEqual(resolveTarget("http://x/"), { ok: false, status: 400 });
});
