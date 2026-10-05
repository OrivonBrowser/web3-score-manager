import assert from "node:assert/strict";
import { test } from "node:test";
import { loadProvider } from "../src/source.ts";

// Orivon Attila, the provider in provider/, judged by the rules in provider/README.md.
const attila = loadProvider(new URL("../provider", import.meta.url).pathname);

test("Orivon Attila's evaluations are valid", () => {
  assert.deepEqual(attila.issues, []);
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
