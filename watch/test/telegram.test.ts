import assert from "node:assert/strict";
import { test } from "node:test";
import type { SourceEvaluation } from "../../src/types.ts";
import { MAX_MESSAGE, formatFailure, formatJudged, formatRunError, shortCid, telegramSender } from "../telegram.ts";
import type { JudgedMessage } from "../telegram.ts";
import { validateVerdict } from "../verdict.ts";
import { goodVerdict } from "./support.ts";

const CID = "bafybeib77kqm53u6qpfczltq56iqbswwtgxqi435e4redd3cdgydkvtbui";

function evaluation(extra: Partial<SourceEvaluation> = {}): SourceEvaluation {
  return {
    subject: "website",
    ids: [`cid:${CID}`],
    name: "Reality",
    evaluated: "2026-10-18",
    trustlessity: { level: 3, privacy: false },
    summary: "Old <summary> & more.",
    connections: [{ name: "Indexer (indexer.reality.gwei.name)", trustlessity: { level: 1, privacy: false } }],
    ...extra,
  };
}

function judged(extra: Partial<JudgedMessage> = {}): JudgedMessage {
  return {
    name: "reality.eth",
    cid: CID,
    oldEval: evaluation(),
    newEval: evaluation({ evaluated: "2026-10-21", summary: "New summary." }),
    verdict: validateVerdict(goodVerdict({ changes: "Nothing <new>." })).verdict!,
    action: "apply",
    reasons: [],
    commitUrl: "https://github.com/OrivonBrowser/web3-score-manager/commit/abc?x=1&y=2",
    publishedCid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    model: "claude-sonnet-5-5",
    costUsd: 0.412,
    turns: 23,
    ...extra,
  };
}

test("a live message shows both judgements, the direction and the links", () => {
  const text = formatJudged(judged());
  assert.match(text, /🛰 <b>Attila re-judged reality\.eth<\/b>/);
  assert.match(text, /New build <code>bafybeib77…tbui<\/code>/);
  assert.match(text, /<b>Before<\/b> · judged 2026-10-18/);
  assert.match(text, /<b>Now<\/b> · 2026-10-21 · ➡️ unchanged/);
  assert.match(text, /🟢 <b>Level 3<\/b> · no privacy/);
  assert.match(text, /✅ Live in Orivon · Attila <code>bafybeigdy…bzdi<\/code>/);
  assert.match(text, /<a href="https:\/\/reality\.eth\.limo\/">Site<\/a>/);
  assert.match(text, /<i>claude-sonnet-5-5 · 23 turns · \$0\.41<\/i>/);
});

test("every interpolated string is escaped, attributes too", () => {
  const text = formatJudged(judged());
  assert.ok(text.includes("Old &lt;summary&gt; &amp; more."));
  assert.ok(text.includes("Nothing &lt;new&gt;."));
  assert.ok(text.includes('href="https://github.com/OrivonBrowser/web3-score-manager/commit/abc?x=1&amp;y=2"'));
  const hostile = formatJudged(judged({ compareUrl: 'https://x/"><script>', action: "hold", reasons: ["a <b>"] }));
  assert.ok(!hostile.includes("<script>"));
  assert.ok(hostile.includes("a &lt;b&gt;"));
});

test("a hold shows the reasons and the pull request link instead of the live line", () => {
  const text = formatJudged(
    judged({
      action: "hold",
      reasons: ["the level rose from 2 to 3"],
      compareUrl: "https://github.com/OrivonBrowser/web3-score-manager/compare/main...attila-watch/x-bafy?expand=1",
      newEval: evaluation({ trustlessity: { level: 4, privacy: true } }),
    }),
  );
  assert.match(text, /<b>⏸ Waiting for your review<\/b>/);
  assert.match(text, /• the level rose from 2 to 3/);
  assert.match(text, /<a href="[^"]+">Open the pull request<\/a>/);
  assert.match(text, /⬆️ raised/);
  assert.match(text, /🟣 <b>Level 4<\/b> · 🛡 privacy/);
  assert.ok(!text.includes("Live in Orivon"));
});

test("concerns get a block, and dry runs say so", () => {
  const verdict = validateVerdict(goodVerdict({ concerns: "A comment addressed the judge." })).verdict!;
  const text = formatJudged(judged({ verdict, dryRun: true, publishedCid: undefined }));
  assert.match(text, /<b>⚠️ Concerns<\/b>/);
  assert.match(text, /Dry run/);
});

test("a long message is cut to 4096 characters without breaking its markup", () => {
  const long = "x &<> ".repeat(900).slice(0, 600);
  const parts = Array.from({ length: 32 }, (_, i) => ({ name: `Part ${i} ${"<".repeat(60)}`, trustlessity: { level: 1, privacy: false } }));
  const text = formatJudged(
    judged({
      oldEval: evaluation({ summary: long, connections: parts, operations: parts }),
      newEval: evaluation({ summary: long, connections: parts, operations: parts }),
      verdict: validateVerdict(goodVerdict({ changes: "y&".repeat(400), concerns: "z<".repeat(400) })).verdict!,
    }),
  );
  assert.ok(text.length <= MAX_MESSAGE, String(text.length));
  assert.ok(text.includes("…"));
  for (const tag of ["b", "code", "i", "blockquote", "a"]) {
    const open = (text.match(new RegExp(`<${tag}[ >]`, "g")) ?? []).length;
    const close = (text.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
    assert.equal(open, close, tag);
  }
  assert.ok(!/&[a-z]*$/.test(text.replace(/&(amp|lt|gt|quot);/g, "")));
});

test("failure and run error messages", () => {
  const retry = formatFailure({ name: "x.eth", cid: CID, reason: "the <build> is too large", attempts: 1, givingUp: false });
  assert.match(retry, /⚠️ <b>Attila could not judge x\.eth<\/b>/);
  assert.match(retry, /the &lt;build&gt; is too large/);
  assert.match(retry, /Will retry next run\./);
  assert.match(formatFailure({ name: "x.eth", cid: CID, reason: "r", attempts: 3, givingUp: true }), /Gave up after 3 tries\./);
  assert.ok(formatRunError("boom ".repeat(2000)).length <= MAX_MESSAGE);
  assert.equal(shortCid("cid:bafy"), "bafy");
});

test("send retries once as plain text on HTTP 400 and never logs the token", async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const logged: string[] = [];
  const fetchFn = (async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response("{}", { status: calls.length === 1 ? 400 : 200 });
  }) as unknown as typeof fetch;
  const sender = telegramSender("123456:SECRETTOKEN", "42", (l) => logged.push(l), fetchFn);
  assert.equal(await sender.send("<b>hi</b> &amp; <i>there</i>"), true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.body.parse_mode, "HTML");
  assert.deepEqual(calls[0]!.body.link_preview_options, { is_disabled: true });
  assert.equal(calls[1]!.body.parse_mode, undefined);
  assert.equal(calls[1]!.body.text, "hi & there");
  assert.ok(calls[0]!.url.includes("/botSECRET") === false && calls[0]!.url.startsWith("https://api.telegram.org/bot"));

  const failing = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
  assert.equal(await telegramSender("123456:SECRETTOKEN", "42", (l) => logged.push(l), failing).send("x"), false);
  assert.ok(logged.length > 0 && logged.every((l) => !l.includes("SECRETTOKEN")));
});
