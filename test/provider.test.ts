import assert from "node:assert/strict";
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
