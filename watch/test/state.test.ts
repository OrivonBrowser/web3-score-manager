import assert from "node:assert/strict";
import { test } from "node:test";
import { tempDir } from "../../test/support.ts";
import { emptyState, loadState, markNotified, recordDone, recordFailure, runErrorDue, saveState, shouldSkip } from "../state.ts";
import { writeTree } from "./support.ts";

const T = "2026-10-21T10:00:00Z";

test("a missing or damaged state file is an empty state", () => {
  const dir = tempDir();
  assert.deepEqual(loadState(dir), emptyState());
  writeTree(dir, { "state.json": "{not json" });
  assert.deepEqual(loadState(dir), emptyState());
});

test("state round-trips", () => {
  const dir = tempDir();
  const state = emptyState();
  recordDone(state, "a.eth", "cid:x", "held", T, "attila-watch/a-x");
  state.pendingPublish = true;
  saveState(dir, state);
  assert.deepEqual(loadState(dir), state);
});

test("held builds are skipped; failures only after the attempts are used; a new CID starts over", () => {
  const state = emptyState();
  recordDone(state, "a.eth", "cid:x", "held", T);
  assert.equal(shouldSkip(state, "a.eth", "cid:x", 3), true);
  assert.equal(shouldSkip(state, "a.eth", "cid:y", 3), false);
  assert.equal(shouldSkip(state, "other.eth", "cid:x", 3), false);

  recordFailure(state, "b.eth", "cid:x", "failed", "boom", T, 3);
  recordFailure(state, "b.eth", "cid:x", "rejected", "boom", T, 3);
  assert.equal(shouldSkip(state, "b.eth", "cid:x", 3), false);
  recordFailure(state, "b.eth", "cid:x", "failed", "boom", T, 3);
  assert.equal(shouldSkip(state, "b.eth", "cid:x", 3), true);
  assert.equal(shouldSkip(state, "b.eth", "cid:z", 3), false);
  assert.equal(recordFailure(state, "b.eth", "cid:z", "failed", "again", T, 3).attempts, 1);
});

test("a failure is announced the first time and when giving up, not in between", () => {
  const state = emptyState();
  const first = recordFailure(state, "a.eth", "cid:x", "failed", "e", T, 3);
  assert.deepEqual([first.notify, first.givingUp], [true, false]);
  markNotified(state, "a.eth");
  const second = recordFailure(state, "a.eth", "cid:x", "failed", "e", T, 3);
  assert.deepEqual([second.notify, second.attempts], [false, 2]);
  const last = recordFailure(state, "a.eth", "cid:x", "failed", "e", T, 3);
  assert.deepEqual([last.notify, last.givingUp], [true, true]);
});

test("a failure whose message was not sent is announced again", () => {
  const state = emptyState();
  recordFailure(state, "a.eth", "cid:x", "failed", "e", T, 5);
  assert.equal(recordFailure(state, "a.eth", "cid:x", "failed", "e", T, 5).notify, true);
});

test("a run-level crash is reported at most once in 24 hours", () => {
  const state = emptyState();
  const now = new Date("2026-10-21T12:00:00Z");
  assert.equal(runErrorDue(state, now), true);
  state.lastRunError = { at: "2026-10-21T03:00:00Z", message: "x" };
  assert.equal(runErrorDue(state, now), false);
  assert.equal(runErrorDue(state, new Date("2026-10-22T04:00:00Z")), true);
});
