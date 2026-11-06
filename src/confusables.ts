// What a string draws as, by Unicode's own table of characters that look alike (UTS #39, the data of `confusables.json`,
// the "MA" table), and the few lookalikes of a reserved word's characters that table does not name. This is Orivon's own
// reading (src/trust/confusables.ts in the Orivon repository), copied so a label that passes here is a label Orivon
// accepts; test/mark-parity.test.ts holds the copy to the table's hash and, when an Orivon checkout is given, to the
// original. Two strings with one skeleton can be told apart by no one at a glance. Pure.
import table from "./confusables.json" with { type: "json" };

/** The characters a character is read as, keyed by the character. */
const MAPPED: ReadonlyMap<string, string> = new Map(
  table.table.split(" ").map((word): [string, string] => {
    const [source = "", targets = ""] = word.split(">");
    return [String.fromCodePoint(parseInt(source, 16)), targets.split(".").map((hex) => String.fromCodePoint(parseInt(hex, 16))).join("")];
  }),
);

/** The version of Unicode's table in use. */
export const CONFUSABLES_VERSION: string = table.version;

/**
 * Lookalikes of the characters a reserved word is spelled with that Unicode's table leaves out (it names the capital that
 * looks alike and not the small capital, nor the ornamental punctuation), each group written as code points then what they
 * draw as. They are read before the table is, so a character both name is read as it is here.
 */
const ALSO_READ: ReadonlyArray<readonly [readonly number[], string]> = [
  [[0x1d00], "a"],
  [[0x0432, 0x03b2, 0x0299], "b"],
  [[0x1d05], "d"],
  [[0x03b5, 0x1d07], "e"],
  [[0x0262], "g"],
  [[0x04c0], "i"],
  [[0x043f, 0x03b7, 0x0397, 0x0274, 0x13b4], "n"],
  [[0x13be], "o"],
  [[0x1d18], "p"],
  [[0x0280], "r"],
  [[0x0442, 0x03c4, 0x1d1b], "t"],
  [[0x03c9], "w"],
  [[0x01a8], "2"],
  [[0x0292, 0x021d, 0x0437, 0x04e1, 0x0498, 0x0499], "3"],
  [[0x01bd], "5"],
  [[0x061f, 0x2753, 0x2754, 0x055e], "?"],
  [[0x2757, 0x2755, 0x00a1, 0x2762, 0x2763], "!"],
];
const ALSO: ReadonlyMap<string, string> = new Map(
  ALSO_READ.flatMap(([points, reads]) =>
    points.map((point) => String.fromCodePoint(point)).flatMap((char) => [[char, reads], [char.toLowerCase(), reads]] as const),
  ),
);

/**
 * The skeleton of `text` (UTS #39 section 4): Unicode form D, the characters that draw as nothing removed, each character
 * replaced by the one the table reads it as, and form D again. The table is case-sensitive, so a capital I reads as an l;
 * a caller that wants both readings of a letter folds case itself and takes the skeleton of each.
 */
export function skeletonOf(text: string): string {
  const decomposed = text.normalize("NFD").replace(/\p{Default_Ignorable_Code_Point}/gu, "");
  return Array.from(decomposed, (char) => ALSO.get(char) ?? MAPPED.get(char) ?? char).join("").normalize("NFD");
}
