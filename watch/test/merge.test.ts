import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { CID } from "multiformats/cid";
import { create as createDigest } from "multiformats/hashes/digest";
import type { SourceEvaluation } from "../../src/types.ts";
import { validateSource } from "../../src/validate.ts";
import { decide, mergeEvaluation, serialiseEvaluation } from "../merge.ts";
import type { ProbeSummary } from "../probe-result.ts";
import { validateVerdict } from "../verdict.ts";
import type { Verdict } from "../verdict.ts";
import { goodVerdict } from "./support.ts";

const NEW = "bafybeib77kqm53u6qpfczltq56iqbswwtgxqi435e4redd3cdgydkvtbui";
const cid = (n: number) => `cid:${CID.createV1(0x55, createDigest(0x12, new Uint8Array(32).fill(n))).toString()}`;
const sha = (c: string) => `sha256:${c.repeat(64)}`;

function old(extra: Partial<SourceEvaluation> = {}): SourceEvaluation {
  return {
    subject: "website",
    ids: [sha("a"), cid(1)],
    names: ["reality.eth"],
    name: "Reality",
    evaluated: "2026-10-01",
    trustlessity: { level: 3, privacy: false },
    summary: "Old summary.",
    connections: [{ name: "Old", trustlessity: { level: 1, privacy: false } }],
    evidence: ["https://github.com/old/old"],
    ...extra,
  };
}

const verdict = (extra: Record<string, unknown> = {}): Verdict => validateVerdict(goodVerdict(extra)).verdict!;
const quiet: ProbeSummary = { renders: true, thirdParty: { origins: [], scripts: [], frames: [] } };

test("the new CID goes last; names, subject and old ids stay", () => {
  const merged = mergeEvaluation(old(), verdict(), NEW, "2026-10-21");
  assert.deepEqual(merged.ids, [sha("a"), cid(1), `cid:${NEW}`]);
  assert.deepEqual(merged.names, ["reality.eth"]);
  assert.equal(merged.subject, "website");
  assert.equal(merged.evaluated, "2026-10-21");
  assert.equal(merged.name, "Example");
});

test("more than eight ids drops the earliest cid, never a sha256 id", () => {
  const ids = [sha("a"), sha("b"), cid(1), cid(2), cid(3), cid(4), cid(5), cid(6)];
  const merged = mergeEvaluation(old({ ids }), verdict(), NEW, "2026-10-21");
  assert.equal(merged.ids.length, 8);
  assert.ok(merged.ids.includes(sha("a")) && merged.ids.includes(sha("b")));
  assert.ok(!merged.ids.includes(cid(1)));
  assert.equal(merged.ids.at(-1), `cid:${NEW}`);
});

test("with only sha256 ids to drop, the earliest one that is not the new id goes", () => {
  const ids = Array.from({ length: 8 }, (_, i) => sha(String(i + 1)));
  const merged = mergeEvaluation(old({ ids }), verdict(), NEW, "2026-10-21");
  assert.equal(merged.ids.length, 8);
  assert.ok(!merged.ids.includes(sha("1")));
  assert.equal(merged.ids.at(-1), `cid:${NEW}`);
});

test("empty evidence falls back to the old evidence; both empty omits the key", () => {
  assert.deepEqual(mergeEvaluation(old(), verdict({ evidence: [] }), NEW, "2026-10-21").evidence, ["https://github.com/old/old"]);
  const none = mergeEvaluation(old({ evidence: undefined }), verdict({ evidence: [] }), NEW, "2026-10-21");
  assert.equal("evidence" in none, false);
  assert.deepEqual(mergeEvaluation(old(), verdict({ evidence: ["https://new.example/"] }), NEW, "2026-10-21").evidence, ["https://new.example/"]);
});

test("parts take the judge's shape; privacy appears only when true; empty arrays are omitted", () => {
  const v = verdict({
    operations: [{ name: "Send", level: 5, privacy: true, note: "n" }, { name: "Plain", level: 2, privacy: false }],
    connections: [],
  });
  const merged = mergeEvaluation(old(), v, NEW, "2026-10-21");
  assert.deepEqual(merged.operations, [
    { name: "Send", trustlessity: { level: 5, privacy: true }, note: "n" },
    { name: "Plain", trustlessity: { level: 2, privacy: false } },
  ]);
  assert.equal("connections" in merged, false);
  const text = serialiseEvaluation(merged);
  assert.ok(text.includes('"trustlessity": {\n        "level": 2\n      }'));
  assert.equal("version" in merged, false);
  assert.equal(mergeEvaluation(old(), verdict({ version: "2.0" }), NEW, "2026-10-21").version, "2.0");
});

test("a merged file passes the repository's own validation", () => {
  const merged = mergeEvaluation(old(), verdict(), NEW, "2026-10-21");
  assert.deepEqual(validateSource(JSON.parse(serialiseEvaluation(merged)), "x.json", "website").issues, []);
});

test("real files survive load and serialise unchanged", () => {
  for (const slug of ["cowswap", "aave", "reality", "explore"]) {
    const file = path.join(import.meta.dirname, "..", "..", "provider", "scores", "website", `${slug}.json`);
    const text = readFileSync(file, "utf8");
    const loaded = validateSource(JSON.parse(text), file, "website");
    assert.deepEqual(loaded.issues, [], slug);
    assert.equal(serialiseEvaluation(loaded.evaluation!), text, slug);
  }
});

test("decide: apply when nothing changed in kind", () => {
  const o = old();
  const v = verdict();
  assert.deepEqual(decide(o, mergeEvaluation(o, v, NEW, "2026-10-21"), v, quiet), { action: "apply", reasons: [] });
  const lower = verdict({ level: 2 });
  assert.equal(decide(o, mergeEvaluation(o, lower, NEW, "2026-10-21"), lower, { ...quiet, thirdParty: { origins: ["https://x"], scripts: ["https://x/a.js"], frames: [] } }).action, "apply");
});

test("decide: reject when it did not render", () => {
  const o = old();
  const v = verdict({ renders: false });
  assert.equal(decide(o, mergeEvaluation(o, v, NEW, "2026-10-21"), v, quiet).action, "reject");
});

test("decide: hold for a level rise, privacy gained, a suspected injection, third-party code at Level 3+", () => {
  const o = old({ trustlessity: { level: 2, privacy: false } });
  const up = verdict({ level: 3 });
  const rise = decide(o, mergeEvaluation(o, up, NEW, "2026-10-21"), up, quiet);
  assert.equal(rise.action, "hold");
  assert.match(rise.reasons.join(), /rose from 2 to 3/);

  const o3 = old({ trustlessity: { level: 4, privacy: false } });
  const gain = verdict({ level: 4, privacy: true });
  assert.match(decide(o3, mergeEvaluation(o3, gain, NEW, "2026-10-21"), gain, quiet).reasons.join(), /privacy/);

  const o2 = old();
  const bad = verdict({ injectionSuspected: true });
  assert.match(decide(o2, mergeEvaluation(o2, bad, NEW, "2026-10-21"), bad, quiet).reasons.join(), /steer/);

  const same = verdict();
  const third = decide(o2, mergeEvaluation(o2, same, NEW, "2026-10-21"), same, { renders: true, thirdParty: { origins: ["https://t"], scripts: ["https://t/a.js"], frames: ["https://t/f"] } });
  assert.equal(third.action, "hold");
  assert.match(third.reasons.join(), /third-party code/);
});
