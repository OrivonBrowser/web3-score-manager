import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { main } from "../src/commands.ts";
import { checkNames, gatewayResolver, report, dnslinkUrl, resolverUrl, DEFAULT_DNSLINK_RESOLVER, DEFAULT_RESOLVER } from "../src/moved.ts";
import { loadProvider } from "../src/source.ts";
import { findDuplicateIds, validateSource } from "../src/validate.ts";
import { makeProvider, website } from "./support.ts";

const V1 = "bafybeiesmy6rsaglneqxbzkbdj5degzp2izydfadhl2vu3oyrp7k52fypu";
const V1_OLD = "bafybeigqyo555suvqi3scc2izft3mozskktbtkzs2xghoe2rpxetxbbdiq";
const V0 = "QmZp8qB3sZJ4odTnAYeo3ivKxVpfj1nyA8V4mxyji2tNcf";
const V0_AS_V1 = "bafybeifkpmerpae2nxb7gfhceyg722rdtyjybmb3fi3ucc75uxqwaxbtga";

const issuesOf = (value: unknown, dir?: "website" | "operation") =>
  validateSource(value, "f.json", dir).issues.map((i) => `${i.path}: ${i.message}`);

const KEY = "ipns://k51qzi5uqu5dli7gc98gxy6jlbarijipfrw1x8z2wfyre3rvhssxvzeummkaff";

test("names: a lowercase host name, ipns://<key> or ipns://<DNSLink host>, on a website evaluation only", () => {
  const good = ["vitalik.eth", "app.example.eth", "docs.ipfs.tech", "xn--nxasmq6b.example", KEY, "ipns://docs.ipfs.tech", "ipns://blog.ipfs.tech", `${"a.".repeat(125)}com`, `ipns://${"a.".repeat(125)}com`];
  for (const name of good) assert.deepEqual(issuesOf(website({ names: [name] }), "website"), [], name);
  assert.deepEqual(validateSource(website({ names: ["a.eth"] }), "f.json").evaluation?.names, ["a.eth"]);
  const bad = ["Vitalik.eth", "eth", "-a.eth", "a-.eth", "a..eth", " a.eth", "a.eth.", "http://a.eth", "ipfs://a.eth", "https://docs.ipfs.tech", "ipns://K51abc", "ipns://k51short", "ipns://docs", "ipns://", `${"a".repeat(64)}.eth`, `${"a.".repeat(127)}com`, `${"a.".repeat(125)}comm`, `ipns://${"a.".repeat(125)}comm`, "127.0.0.1", "192.168.1.1", "ipns://10.0.0.1", "a.1"];
  for (const name of bad) assert.ok(issuesOf(website({ names: [name] })).some((m) => m.startsWith("names[0]:")), name);
  assert.ok(issuesOf(website({ names: [] })).some((m) => m.startsWith("names:")));
  const nine = Array.from({ length: 9 }, (_, i) => `s${i}.eth`);
  assert.ok(issuesOf(website({ names: nine })).some((m) => m.startsWith("names:")));
  assert.deepEqual(issuesOf(website({ names: nine.slice(0, 8) })), []);
  assert.ok(issuesOf(website({ names: ["a.eth", "a.eth"] })).some((m) => m.startsWith("names[1]:")));
  const operation = { subject: "operation", ids: ["eip155:1:0xab"], name: "Op", evaluated: "2026-10-03", trustlessity: { level: 2, privacy: false }, names: ["a.eth"] };
  assert.ok(issuesOf(operation, "operation").some((m) => m.startsWith("names:")));
});

test("a name may be listed by several evaluations; an identifier may not", () => {
  const one = { file: "one.json", evaluation: validateSource(website({ names: ["a.eth"] }), "one.json").evaluation! };
  const two = { file: "two.json", evaluation: validateSource(website({ ids: [`cid:${V1}`], names: ["a.eth"] }), "two.json").evaluation! };
  assert.deepEqual(findDuplicateIds([one, two]), []);
  const same = { file: "three.json", evaluation: validateSource(website({ names: ["b.eth"] }), "three.json").evaluation! };
  assert.deepEqual(findDuplicateIds([one, same]), [{ file: "three.json", path: "ids[0]", message: `${one.evaluation.ids[0]} is already listed by one.json` }]);
});

test("the ENS template and the DNSLink query address are built from the name", () => {
  assert.equal(resolverUrl("vitalik.eth", DEFAULT_RESOLVER), "https://vitalik.eth.limo/");
  assert.equal(resolverUrl("ipns://docs.ipfs.tech", "https://g/{name}"), "https://g/docs.ipfs.tech");
  assert.equal(dnslinkUrl("docs.ipfs.tech", DEFAULT_DNSLINK_RESOLVER), "https://cloudflare-dns.com/dns-query?name=_dnslink.docs.ipfs.tech&type=TXT");
  assert.equal(dnslinkUrl("a.org", "https://dns.example/q?x=1"), "https://dns.example/q?x=1&name=_dnslink.a.org&type=TXT");
});

test("the resolver reads the first X-Ipfs-Roots entry and canonicalises it", async () => {
  const asked: string[] = [];
  const answer = (status: number, roots?: string) => async (url: string | URL | Request) => {
    asked.push(String(url));
    return new Response(null, { status, headers: roots === undefined ? {} : { "x-ipfs-roots": roots } });
  };
  assert.equal(await gatewayResolver("https://{name}.limo/", answer(200, `${V0},${V1}`) as typeof fetch)("hop.eth"), `cid:${V0_AS_V1}`);
  assert.deepEqual(asked, ["https://hop.eth.limo/"]);
  await gatewayResolver("https://g/{name}", answer(200, V1) as typeof fetch)("ipns://docs.ipfs.tech");
  assert.equal(asked.at(-1), "https://g/docs.ipfs.tech");
  await assert.rejects(gatewayResolver("https://g/{name}", answer(200) as typeof fetch)("a.eth"), /no X-Ipfs-Roots/);
  await assert.rejects(gatewayResolver("https://g/{name}", answer(504, V1) as typeof fetch)("a.eth"), /answered 504/);
  await assert.rejects(gatewayResolver("https://g/{name}", answer(200, "not-a-cid") as typeof fetch)("a.eth"), /not a CID/);
  const unreachable = async () => Promise.reject(new TypeError("fetch failed", { cause: new Error("certificate has expired") }));
  await assert.rejects(gatewayResolver("https://g/{name}", unreachable as typeof fetch)("a.eth"), /^Error: https:\/\/g\/a\.eth could not be reached: certificate has expired$/);
});

test("DNS hosts and ipns:// names are read from the DNSLink record through DNS over HTTPS", async () => {
  const asked: { url: string; accept: string | null }[] = [];
  const txt = (data: string) => ({ Status: 0, Answer: [{ name: "_dnslink.x", type: 5, data: "_dnslink.y." }, { name: "_dnslink.y", type: 16, data }] });
  const answer = (status: number, body: unknown) => async (url: string | URL | Request, init?: RequestInit) => {
    asked.push({ url: String(url), accept: new Headers(init?.headers).get("accept") });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  const resolve = (fetchFn: unknown, endpoint?: string) => gatewayResolver(DEFAULT_RESOLVER, fetchFn as typeof fetch, 1000, endpoint);
  const record = answer(200, txt(`"dnslink=/ipfs/${V0}"`));
  assert.equal(await resolve(record)("docs.ipfs.tech"), `cid:${V0_AS_V1}`);
  assert.deepEqual(asked[0], { url: "https://cloudflare-dns.com/dns-query?name=_dnslink.docs.ipfs.tech&type=TXT", accept: "application/dns-json" });
  assert.equal(await resolve(record, "https://dns.example/q")("ipns://docs.ipfs.tech"), `cid:${V0_AS_V1}`);
  assert.equal(asked.at(-1)!.url, "https://dns.example/q?name=_dnslink.docs.ipfs.tech&type=TXT");
  assert.equal(await resolve(answer(200, txt(`"dnslink=/ipfs/${V1}/docs"`)))("a.org"), `cid:${V1}`);
  assert.equal(await resolve(answer(200, { Status: 0, Answer: [{ type: 16, data: '"v=spf1" "x"' }, { type: 16, data: `"dnslink=/ipfs/${V1}"` }] }))("a.org"), `cid:${V1}`);
  await assert.rejects(resolve(answer(200, txt('"dnslink=/ipns/k51abc"')))("a.org"), /DNSLink record of a\.org is \/ipns\/k51abc, not an \/ipfs\//);
  await assert.rejects(resolve(answer(200, { Status: 3 }))("a.org"), /a\.org has no DNSLink record/);
  await assert.rejects(resolve(answer(200, "<html>"))("a.org"), /did not answer in the DNS JSON form/);
  await assert.rejects(resolve(answer(503, {}))("a.org"), /answered 503/);
  await assert.rejects(resolve(answer(200, txt('"dnslink=/ipfs/not-a-cid"')))("a.org"), /not a CID/);
  await assert.rejects(resolve(record)("ipns://k51qzi5uqu5dli7gc98gxy6jlbarijipfrw1x8z2wfyre3rvhssxvzeummkaff"), /ipns:\/\/ key is not resolved/);
  const asking = asked.length;
  await gatewayResolver(DEFAULT_RESOLVER, (async (url: string | URL | Request) => (asked.push({ url: String(url), accept: null }), new Response(null, { headers: { "x-ipfs-roots": V1 } }))) as typeof fetch)("app.eth");
  assert.equal(asked.length, asking + 1);
  assert.equal(asked.at(-1)!.url, "https://app.eth.limo/");
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

test("a name in two evaluations is judged when it resolves to an id of either", async () => {
  const dir = makeProvider([
    ["website", "app-1", website({ ids: [`cid:${V1_OLD}`], names: ["app.eth", "ipns://docs.ipfs.tech"], evaluated: "2026-10-01" })],
    ["website", "app-2", website({ ids: [`cid:${V1}`], names: ["app.eth"], evaluated: "2026-10-02" })],
  ]);
  const at = (roots: Record<string, string>) => checkNames(loadProvider(dir).evaluations, async (name) => roots[name] ?? Promise.reject(new Error("no answer")));
  const [older, newer] = [`cid:${V1_OLD}`, `cid:${V1}`];
  assert.deepEqual((await at({ "app.eth": older })).map((s) => `${s.kind} ${s.name} ${s.file.split("/").pop()}`), ["judged app.eth app-1.json", "unresolved ipns://docs.ipfs.tech app-1.json"]);
  assert.equal((await at({ "app.eth": newer }))[0]!.kind, "judged");
  const elsewhere = await at({ "app.eth": `cid:${V0_AS_V1}` });
  assert.deepEqual(elsewhere[0], { kind: "moved", name: "app.eth", file: elsewhere[0]!.file, now: `cid:${V0_AS_V1}` });
  assert.match(elsewhere[0]!.file, /app-2\.json$/);
  assert.equal(elsewhere.length, 2);
});

test("a moved name points at the later file of its app when two share a day", async () => {
  const ids = Array.from({ length: 8 }, (_, i) => `sha256:${String(i).repeat(64)}`);
  const dir = makeProvider([
    ["website", "explore", website({ ids, names: ["app.eth"], evaluated: "2026-10-05" })],
    ["website", "explore-2", website({ ids: [`sha256:${"9".repeat(64)}`], names: ["app.eth"], evaluated: "2026-10-05" })],
  ]);
  const [state] = await checkNames(loadProvider(dir).evaluations, async () => `cid:${V0_AS_V1}`);
  assert.equal(state!.kind, "moved");
  assert.match(state!.file, /explore-2\.json$/);
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
