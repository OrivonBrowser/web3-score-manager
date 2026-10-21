import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../../test/support.ts";
import { resolveGatewayPath } from "../gateway-path.ts";
import { link, writeTree } from "./support.ts";

function site(files: Record<string, string>): string {
  const dir = tempDir();
  writeTree(dir, files);
  return dir;
}

test("a file is served with its content type; a directory serves its index", () => {
  const dir = site({ "index.html": "<p>home</p>", "app.js": "1", "sub/index.html": "<p>sub</p>", "a/b.css": "x" });
  assert.deepEqual(resolveGatewayPath(dir, "/"), { status: 200, file: path.join(realpath(dir), "index.html"), headers: { "Content-Type": "text/html; charset=utf-8" } });
  assert.equal(resolveGatewayPath(dir, "/app.js").headers["Content-Type"], "text/javascript; charset=utf-8");
  assert.equal(resolveGatewayPath(dir, "/a/b.css?v=1").headers["Content-Type"], "text/css; charset=utf-8");
  assert.equal(resolveGatewayPath(dir, "/sub/").file, path.join(realpath(dir), "sub", "index.html"));
  assert.equal(resolveGatewayPath(dir, "/sub").file, path.join(realpath(dir), "sub", "index.html"));
});

test("a directory without an index is listed", () => {
  const dir = site({ "files/one.txt": "1", "files/two<x>.txt": "2", "files/deep/z.txt": "3" });
  const got = resolveGatewayPath(dir, "/files/");
  assert.equal(got.status, 200);
  assert.ok(got.body?.includes("<ul>"));
  assert.ok(got.body?.includes('<a href="one.txt">one.txt</a>'));
  assert.ok(got.body?.includes('deep/</a>'));
  assert.ok(!got.body?.includes("<x>"));
});

test("_redirects: a splat rewrite, a redirect, and a 404 page", () => {
  const dir = site({
    "index.html": "app",
    "404.html": "gone",
    "_redirects": ["# comment", "/old/* /new/:splat 301", "/docs/* /index.html 200", "/missing /404.html 404", "/nowhere https://example.org/ 302"].join("\n"),
    "new/page.html": "p",
  });
  assert.deepEqual(resolveGatewayPath(dir, "/old/page.html"), { status: 301, headers: { Location: "/new/page.html", "Content-Type": "text/plain; charset=utf-8" }, body: "" });
  const rewrite = resolveGatewayPath(dir, "/docs/deep/route");
  assert.equal(rewrite.status, 200);
  assert.equal(rewrite.file, path.join(realpath(dir), "index.html"));
  const gone = resolveGatewayPath(dir, "/missing");
  assert.equal(gone.status, 404);
  assert.equal(gone.file, path.join(realpath(dir), "404.html"));
  assert.equal(resolveGatewayPath(dir, "/nowhere").status, 302);
});

test("ipfs-404.html: the nearest one from the requested directory up", () => {
  const dir = site({ "ipfs-404.html": "root", "docs/ipfs-404.html": "docs", "docs/x.html": "x" });
  assert.equal(resolveGatewayPath(dir, "/docs/nope").file, path.join(realpath(dir), "docs", "ipfs-404.html"));
  assert.equal(resolveGatewayPath(dir, "/other/nope").file, path.join(realpath(dir), "ipfs-404.html"));
  assert.equal(resolveGatewayPath(dir, "/docs/nope").status, 404);
  const bare = site({ "index.html": "x" });
  assert.deepEqual(resolveGatewayPath(bare, "/nope"), { status: 404, body: "404 page not found", headers: { "Content-Type": "text/plain; charset=utf-8" } });
});

test("parent segments and NUL are refused, also when encoded", () => {
  const dir = site({ "index.html": "x" });
  for (const bad of ["/../etc/passwd", "/a/../../x", "/%2e%2e/x", "/a%00b", "/%E0%A4%A"]) {
    assert.equal(resolveGatewayPath(dir, bad).status, 400, bad);
  }
});

test("a symlink that leads out of the site is refused", () => {
  const outside = site({ "secret.txt": "top secret", "index.html": "outside index" });
  const dir = site({ "index.html": "ok" });
  link(path.join(outside, "secret.txt"), path.join(dir, "leak.txt"));
  link(outside, path.join(dir, "outdir"));
  link(path.join(outside, "secret.txt"), path.join(dir, "ipfs-404.html"));
  assert.equal(resolveGatewayPath(dir, "/leak.txt").status, 403);
  assert.equal(resolveGatewayPath(dir, "/outdir/").status, 403);
  assert.equal(resolveGatewayPath(dir, "/outdir/secret.txt").status, 403);
  const missing = resolveGatewayPath(dir, "/nope");
  assert.equal(missing.status, 404);
  assert.equal(missing.file, undefined);
});

test("a symlink that stays inside the site is followed", () => {
  const dir = site({ "real/a.txt": "a" });
  mkdirSync(path.join(dir, "x"));
  link(path.join(dir, "real", "a.txt"), path.join(dir, "x", "b.txt"));
  const got = resolveGatewayPath(dir, "/x/b.txt");
  assert.equal(got.status, 200);
  assert.equal(got.file, path.join(realpath(dir), "real", "a.txt"));
});

import { realpathSync } from "node:fs";
function realpath(p: string): string {
  return realpathSync(p);
}
