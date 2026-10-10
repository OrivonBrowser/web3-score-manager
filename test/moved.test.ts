import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { main } from "../src/commands.ts";
import { checkNames, gatewayResolver, report } from "../src/moved.ts";
import { loadProvider } from "../src/source.ts";
import { findDuplicateIds, validateSource } from "../src/validate.ts";
import { makeProvider, website } from "./support.ts";

const V1 = "bafybeiesmy6rsaglneqxbzkbdj5degzp2izydfadhl2vu3oyrp7k52fypu";
const V1_OLD = "bafybeigqyo555suvqi3scc2izft3mozskktbtkzs2xghoe2rpxetxbbdiq";
const V0 = "QmZp8qB3sZJ4odTnAYeo3ivKxVpfj1nyA8V4mxyji2tNcf";
const V0_AS_V1 = "bafybeifkpmerpae2nxb7gfhceyg722rdtyjybmb3fi3ucc75uxqwaxbtga";

const issuesOf = (value: unknown, dir?: "website" | "operation") =>
  validateSource(value, "f.json", dir).issues.map((i) => `${i.path}: ${i.message}`);

test("names: lowercase .eth names on a website evaluation only", () => {
  assert.deepEqual(issuesOf(website({ names: ["vitalik.eth", "app.example.eth"] }), "website"), []);
  assert.deepEqual(validateSource(website({ names: ["a.eth"] }), "f.json").evaluation?.names, ["a.eth"]);
  for (const bad of ["Vitalik.eth", "vitalik.com", "eth", "-a.eth", "a..eth", " a.eth"]) {
    assert.ok(issuesOf(website({ names: [bad] })).some((m) => m.startsWith("names[0]:")), bad);
  }
  assert.ok(issuesOf(website({ names: [] })).some((m) => m.startsWith("names:")));
  assert.ok(issuesOf(website({ names: ["a.eth", "a.eth"] })).some((m) => m.startsWith("names[1]:")));
  const operation = { subject: "operation", ids: ["eip155:1:0xab"], name: "Op", evaluated: "2026-10-03", trustlessity: { level: 2, privacy: false }, names: ["a.eth"] };
  assert.ok(issuesOf(operation, "operation").some((m) => m.startsWith("names:")));
});

test("a name watched by two evaluations is an error on the later file", () => {
  const one = { file: "one.json", evaluation: validateSource(website({ names: ["a.eth"] }), "one.json").evaluation! };
  const two = { file: "two.json", evaluation: validateSource(website({ ids: [`cid:${V1}`], names: ["a.eth"] }), "two.json").evaluation! };
  assert.deepEqual(findDuplicateIds([one, two]), [{ file: "two.json", path: "names[0]", message: "a.eth is already listed by one.json" }]);
});

test("the resolver reads the first X-Ipfs-Roots entry and canonicalises it", async () => {
  const asked: string[] = [];
  const answer = (status: number, roots?: string) => async (url: string | URL | Request) => {
    asked.push(String(url));
    return new Response(null, { status, headers: roots === undefined ? {} : { "x-ipfs-roots": roots } });
  };
  assert.equal(await gatewayResolver("https://{name}.limo/", answer(200, `${V0},${V1}`) as typeof fetch)("hop.eth"), `cid:${V0_AS_V1}`);
  assert.deepEqual(asked, ["https://hop.eth.limo/"]);
  await assert.rejects(gatewayResolver("https://g/{name}", answer(200) as typeof fetch)("a.eth"), /no X-Ipfs-Roots/);
  await assert.rejects(gatewayResolver("https://g/{name}", answer(504, V1) as typeof fetch)("a.eth"), /answered 504/);
  await assert.rejects(gatewayResolver("https://g/{name}", answer(200, "not-a-cid") as typeof fetch)("a.eth"), /not a CID/);
  const unreachable = async () => Promise.reject(new TypeError("fetch failed", { cause: new Error("certificate has expired") }));
  await assert.rejects(gatewayResolver("https://g/{name}", unreachable as typeof fetch)("a.eth"), /^Error: https:\/\/g\/a\.eth could not be reached: certificate has expired$/);
});

test("each name is judged, moved or unresolved; the report fails only on a move or when nothing resolved", async () => {
  const dir = makeProvider([
    ["website", "blog", website({ ids: [`cid:${V1_OLD}`], names: ["blog.eth"] })],
    ["website", "app", website({ ids: [`cid:${V1}`], names: ["app.eth", "gone.eth"] })],
  ]);
  const roots: Record<string, string> = { "blog.eth": `cid:${V1}`, "app.eth": `cid:${V1}` };
  const resolve = async (name: string) => roots[name] ?? Promise.reject(new Error("no answer"));
  const states = await checkNames(loadProvider(dir).evaluations, resolve);
  assert.deepEqual(states.map((s) => `${s.kind} ${s.name}`).sort(), ["judged app.eth", "moved blog.eth", "unresolved gone.eth"]);
  const { text, failed } = report(states);
  assert.ok(failed);
  assert.match(text, new RegExp(`^moved {7}blog\\.eth  now cid:${V1}  \\(.*blog\\.json\\)$`, "m"));
  assert.match(text, /^unresolved {2}gone\.eth {2}no answer/m);
  assert.match(text, /^3 names: 1 serve a judged build, 1 moved, 1 unresolved$/m);

  assert.equal(report(states.filter((s) => s.kind !== "moved")).failed, false);
  assert.equal(report(states.filter((s) => s.kind === "unresolved")).failed, true);
  assert.equal(report([]).failed, false);
});

test("moved asks the resolver for every watched name and exits 1 when one moved", async () => {
  const roots: Record<string, string> = { "/blog.eth": V1, "/app.eth": V1 };
  const server = createServer((req, res) => {
    const root = roots[req.url ?? ""];
    res.writeHead(root ? 200 : 404, root ? { "x-ipfs-roots": root } : {}).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const resolver = `http://127.0.0.1:${(server.address() as AddressInfo).port}/{name}`;
  const run = async (dir: string) => {
    let out = "";
    const code = await main(["moved", "--dir", dir, "--resolver", resolver], { out: (t) => void (out += t), err: (t) => void (out += t) });
    return { code, out };
  };
  try {
    const judged = await run(makeProvider([["website", "app", website({ ids: [`cid:${V1}`], names: ["app.eth"] })]]));
    assert.deepEqual(judged, { code: 0, out: "1 names: 1 serve a judged build, 0 moved, 0 unresolved\n" });
    const moved = await run(makeProvider([["website", "blog", website({ ids: [`cid:${V1_OLD}`], names: ["blog.eth"] })]]));
    assert.equal(moved.code, 1);
    assert.match(moved.out, /^moved {7}blog\.eth/m);
  } finally {
    server.close();
  }
  const bad = await main(["moved", "--resolver", "https://example.org/"], { out: () => {}, err: () => {} });
  assert.equal(bad, 1);
});
