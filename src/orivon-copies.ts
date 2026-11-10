import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The files of this tool that are copies of Orivon's own, each named as it is in `src/` here. There they are in `src/trust/`,
 * but for the table of lookalikes, which is in `src/protocols/resolution/` (`originalOf`). They are Orivon's text, whole: a
 * change to a rule is made in Orivon and copied here, never made here, so a marks file that passes `check` is a file Orivon
 * draws. Pure apart from reading files.
 */
export const COPIES: readonly string[] = ["confusables.json", "confusables.LICENSE.txt", "confusables.ts", "mark-values.ts", "reserved-words.ts"];

/** The path of a copy's original in the Orivon checkout at `orivonRoot`: the table of lookalikes and its notice are in `src/protocols/resolution/`, every other file in `src/trust/`. */
export const originalOf = (orivonRoot: string, name: string): string =>
  path.join(orivonRoot, "src", name.startsWith("confusables.") ? path.join("protocols", "resolution") : "trust", name);

/** A text without its import lines, the only lines in which a copy may differ from its original: Orivon names a module by its `.js` file and this tool by its `.ts` one, and a JSON import carries its type. */
export const withoutImports = (text: string): string =>
  text
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter((line) => !line.startsWith("import "))
    .join("\n");

/** The SHA-256 of a copy's text without its import lines: the same value for the original and the copy while they agree. */
export const digestOf = (text: string): string => createHash("sha256").update(withoutImports(text)).digest("hex");

const read = (file: string): string | undefined => (existsSync(file) ? readFileSync(file, "utf8") : undefined);

/** The copies, by name, that differ from the original in `orivonRoot` (the root of an Orivon checkout) or whose original is not there. `ownRoot` is the root of this tool. */
export function differingCopies(orivonRoot: string, ownRoot: string): string[] {
  return COPIES.filter((name) => {
    const original = read(originalOf(orivonRoot, name));
    const copy = read(path.join(ownRoot, "src", name));
    return original === undefined || copy === undefined || withoutImports(original) !== withoutImports(copy);
  });
}

/** Throws unless `orivonRoot` names an Orivon checkout whose files every copy here equals. A release is never prepared on a reader that may have drifted from Orivon's. */
export function assertCopiesCurrent(orivonRoot: string | undefined, ownRoot: string): void {
  if (orivonRoot === undefined || orivonRoot === "") {
    throw new Error("ORIVON_REPO is not set: name an Orivon checkout, so the copies of its mark and label readers can be compared with it before a release");
  }
  const stale = differingCopies(orivonRoot, ownRoot);
  if (stale.length > 0) {
    throw new Error(`these files differ from Orivon's, in src/trust/ and src/protocols/resolution/ at ORIVON_REPO, or are missing there; copy them again: ${stale.join(", ")}`);
  }
}
