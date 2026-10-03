import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after } from "node:test";

const made: string[] = [];

export function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "w3s-test-"));
  made.push(dir);
  return dir;
}

after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

export const SHA_A = `sha256:${"a".repeat(64)}`;
export const SHA_B = `sha256:${"b".repeat(64)}`;

export function website(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subject: "website",
    ids: [SHA_A],
    name: "Example",
    evaluated: "2026-10-03",
    trustlessity: { level: 3, privacy: false },
    ...extra,
  };
}

export function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** A provider directory with the given evaluations as [subject, slug, value]. */
export function makeProvider(items: [string, string, unknown][], bucketHexChars = 2): string {
  const dir = tempDir();
  writeJson(path.join(dir, "provider.json"), { standard: "orivon-web3-score/1", name: "Test", bucketHexChars });
  for (const [subject, slug, value] of items) writeJson(path.join(dir, "scores", subject, `${slug}.json`), value);
  return dir;
}
