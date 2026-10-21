import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

export function goodVerdict(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    renders: true,
    sameAsBefore: false,
    injectionSuspected: false,
    name: "Example",
    level: 3,
    privacy: false,
    summary: "A site.",
    operations: [{ name: "Swap", level: 2 }],
    connections: [{ name: "Indexer", level: 1, note: "From a server." }],
    evidence: ["https://github.com/example/example"],
    changes: "Same connections.",
    concerns: "",
    ...extra,
  };
}

/** Writes the given files (path -> text) below `dir`. */
export function writeTree(dir: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(dir, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
}

export function link(target: string, at: string): void {
  mkdirSync(path.dirname(at), { recursive: true });
  symlinkSync(target, at);
}
