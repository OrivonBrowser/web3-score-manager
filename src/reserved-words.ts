// The words Orivon draws itself, and whether a provider's mark label spells one. Apart from mark-values.ts because it
// carries Unicode's table of lookalikes, which only the process that reads a provider's file needs. Pure.

import { skeletonOf } from './confusables.ts'

/** The words Orivon draws itself: the three graded marks, Web?, Unprotected, and the warning and its "!". `web25` is Web2.5 once its dot is gone. Longer words come before the shorter ones they begin with. */
const WORDS = ['web25', 'web2', 'web3', 'web?', 'unprotected', 'warning', '!']

/** Two characters that draw as one, in lower case, and the one they draw as: the pairs that stand for a letter of a reserved word, and the pair a reserved word holds that one letter stands for. */
const PAIRS: ReadonlyArray<readonly [string, string]> = [['vv', 'w'], ['uu', 'w'], ['cl', 'd'], ['ri', 'n'], ['lo', 'b'], ['rn', 'm']]

/** Letters drawn from punctuation, as the skeleton spells it (it reads "|", "1" and "I" as "l"), and the letter they draw. */
const DRAWN: ReadonlyArray<readonly [RegExp, string]> = [[/\\\/\\\/|\\[vux^]\//g, 'w'], [/\/\\\/\\/g, 'm'], [/l\\l|\/\\\//g, 'n'], [/l_l/g, 'u'], [/\\\//g, 'v']]

/** `letters` with every pair in PAIRS written as the one character it draws, until none is left. */
function fused (letters: string): string {
  const next = PAIRS.reduce((held, [pair, one]) => held.replaceAll(pair, one), letters)
  return next === letters ? letters : fused(next)
}

/** What is left of a lower-case skeleton once only the characters that could spell a reserved word remain: letters, digits, "?" and "!". */
const lettersOf = (skeleton: string): string => skeleton.replace(/[^\p{L}\p{N}?!]+/gu, '')

/** Each reserved word as it is and as `fused` writes it, both naming the word: a label is read in both forms, so a word is found whole and written with the character a pair draws ("waming"), and a pair that spans a word boundary never costs a genuine word. */
const WORD_OF: ReadonlyMap<string, string> = new Map(WORDS.flatMap((word) => [[word, word], [fused(word), word]] as const))
const RESERVED = new RegExp([...WORD_OF.keys()].map((word) => word.replace(/[?]/g, '\\$&')).join('|'), 'g')

/** The ways a skeleton can be read: as its characters are and with the letters drawn from punctuation written as letters, each as it is and with its pairs fused. */
function readings (text: string): string[] {
  const skeleton = skeletonOf(text).toLowerCase()
  const drawn = DRAWN.reduce((held, [shape, letter]) => held.replace(shape, letter), skeleton)
  return [skeleton, drawn].flatMap((read) => { const letters = lettersOf(read); return [letters, fused(letters)] })
}

/** Every way `text` reads: folded as it is and in lower case (the table is case-sensitive), each as its skeleton and as its drawn letters. */
const formsOf = (text: string): string[] => {
  const folded = text.normalize('NFKD')
  return [folded, folded.toLowerCase()].flatMap(readings)
}

/**
 * What `text` draws as: the forms `reservedWordsIn` reads a label in, for two texts that a person cannot tell apart at a glance
 * to share one. Spacing, case, accents, punctuation, Unicode's lookalike letters and the pairs of characters that draw as one all
 * make no second text.
 */
export const drawnAs = (text: string): string[] => [...new Set(formsOf(text))]

/**
 * Whether `label` is the reserved word `word` (`web2`, `web25`, `web3`) and nothing besides it: each way the label reads
 * (`drawnAs`) is the word, once the pairs that draw as one letter are written as it. "Web2", "WEB 2" and "Wéb2" are `web2`;
 * "Web2 plus" is not, and neither is a label with a letter the table does not fold to a letter of the word.
 * Letters drawn from punctuation (`\/\/eb3`) do not count: the raw reading drops the punctuation, so such a label is not the word.
 */
export const drawsAs = (label: string, word: string): boolean => drawnAs(label).every((form) => fused(form) === fused(word))

/**
 * The reserved words a label reads as. The label is folded (compatibility, accents), then read as Unicode's table of
 * lookalikes reads it (confusables.ts), and everything that is not a letter, a digit, "?" or "!" is dropped, so "Web 3",
 * "WEB-3", "Web/3", "Wéb3", the same word wholly in Cyrillic, Greek or Cherokee letters and "WebƷ" all read as `web3`. Two
 * characters that draw as one read as it ("VVeb3", "uueb3", "\/\/eb3", "Waming" for the "rn" of "Warning"), on both sides of the
 * comparison. The table is case-sensitive (a capital "I" is an "l", a Cherokee "Ꮃ" a capital "W"), so the label is read as it is
 * and again in lower case, and a word found in either reading is found. The pairs and the punctuation letters are the ones in
 * use, not every one that could be drawn: README.md's Design notes says what the rest rests on.
 */
export function reservedWordsIn (label: string): string[] {
  const [first = [], ...others] = formsOf(label).map((read) => (read.match(RESERVED) ?? []).map((word) => WORD_OF.get(word) ?? word))
  return others.every((words) => words.every((word) => first.includes(word))) ? first : [...new Set([first, ...others].flat())]
}
