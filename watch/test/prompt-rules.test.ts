import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The judge reads provider/README.md as rules.md (run.ts), so the prompt's references to it are
// checked against the README itself.
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const flat = (text: string) => text.replace(/\s+/g, " ");

const prompt = flat(read("../judge/prompt.md"));
const readme = read("../../provider/README.md");
const schema = JSON.parse(read("../judge/schema.json")) as {
  properties: Record<"operations" | "connections", { items: { properties: { level: { maximum: number } } } }>;
};

const headings = [...readme.matchAll(/^#{1,3} (.+)$/gm)].map((m) => m[1]!);

test("every rules.md section the prompt cites is a heading of the README", () => {
  const cited = [...prompt.matchAll(/rules\.md section (.+?)(?=[,;.:]| allows)/gi)].map((m) => m[1]!);
  assert.ok(cited.length >= 3, `found only ${cited.length} citations in the prompt`);
  for (const section of cited) assert.ok(headings.includes(section), `rules.md has no section "${section}"`);
});

test("the rule the prompt quotes from rules.md is in the README", () => {
  const quoted = prompt.match(/Rules\.md: "([^"]+)"/)?.[1];
  assert.ok(quoted, "the prompt quotes no rule");
  const words = quoted.replace(/\.$/, "");
  assert.ok(flat(readme).includes(words), `the README does not say: ${words}`);
});

// A judge that is told only the range of a level has to guess what each level means.
test("the README defines every operation and connection level the schema allows", () => {
  const section = readme.split(/^## The operation and connection levels$/m)[1]?.split(/^## /m)[0];
  assert.ok(section, "the README has no section The operation and connection levels");
  const [operations = "", connections = ""] = section.split(/^Connections, /m).map((part) => part.split(/^Operations, /m).at(-1)!);
  const levels = (text: string) => [...text.matchAll(/^- \*\*Level (\d):\*\*/gm)].map((m) => Number(m[1]));
  const upTo = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
  assert.deepEqual(levels(operations), upTo(schema.properties.operations.items.properties.level.maximum));
  assert.deepEqual(levels(connections), upTo(schema.properties.connections.items.properties.level.maximum));
});
