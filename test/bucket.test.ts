import assert from "node:assert/strict";
import { test } from "node:test";
import { bucketOf } from "../src/bucket.ts";

const VECTORS: [string, string][] = [
  ["sha256:26054c511f3394b66c6a022a48d82e559d637ac4b111657482ec6b7a7447fbcf", "4c"],
  ["sha256:b6761c9738dab8dae6c3ac00c9d048e26992ebbd5f095601f1b8e4782ee24cb2", "da"],
  ["cid:bafybeieqer67ojhi6q3eiatmrcu3r3mqjehn7hwit2satqjfnljo65fb4q", "c6"],
];

test("bucket test vectors at 2 hex characters", () => {
  for (const [id, bucket] of VECTORS) assert.equal(bucketOf(id, 2), bucket);
});

test("bucket widths follow the full hash prefix", () => {
  assert.equal(bucketOf(VECTORS[0]![0], 8), "4c965259");
  assert.equal(bucketOf(VECTORS[1]![0], 4), "daf1");
  assert.equal(bucketOf(VECTORS[2]![0], 1), "c");
});
