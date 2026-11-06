// The words Orivon draws itself, and whether a provider's mark label spells one. Orivon's own reading
// (src/trust/reserved-words.ts in the Orivon repository), so a label that passes here is a label Orivon accepts. Apart from
// mark-values.ts because it carries Unicode's table of lookalikes, which only a check of marks needs. Pure.

import { skeletonOf } from "./confusables.ts";

/** The words Orivon draws itself: the three graded marks, Web?, Unprotected, and the warning and its "!". `web25` is Web2.5 once its dot is gone. */
const RESERVED = /web25|web2|web3|web\?|unprotected|warning|!/g;

/** What is left of a skeleton once only the characters that could spell a reserved word remain: letters, digits, "?" and "!", in lower case. */
const lettersOf = (skeleton: string): string => skeleton.toLowerCase().replace(/[^\p{L}\p{N}?!]+/gu, "");

/**
 * The reserved words a label reads as. The label is folded (compatibility, accents), then read as Unicode's table of
 * lookalikes reads it (confusables.ts), and everything that is not a letter, a digit, "?" or "!" is dropped, so "Web 3",
 * "WEB-3", "Web/3", "Wéb3", the same word wholly in Cyrillic, Greek or Cherokee letters and "WebƷ" all read as `web3`. The
 * table is case-sensitive (a capital "I" is an "l", a Cherokee "Ꮃ" a capital "W"), so the label is read as it is and again
 * in lower case, and a word found in either reading is found.
 */
export function reservedWordsIn(label: string): string[] {
  const folded = label.normalize("NFKD");
  const found = (text: string): string[] => lettersOf(skeletonOf(text)).match(RESERVED) ?? [];
  const first = found(folded);
  const second = found(folded.toLowerCase());
  return second.every((word) => first.includes(word)) ? first : [...new Set([...first, ...second])];
}
