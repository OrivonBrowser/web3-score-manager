// The words Orivon draws itself, and whether a provider's mark label spells one. Apart from mark-values.ts because it
// carries Unicode's table of lookalikes, which only the process that reads a provider's file needs. Pure.

import { skeletonOf } from './confusables.ts'

/** The words Orivon draws itself: the three graded marks, Web?, Unprotected, and the warning and its "!". `web25` is Web2.5 once its dot is gone. Longer words come before the shorter ones they begin with. */
const WORDS = ['web25', 'web2', 'web3', 'web?', 'unprotected', 'warning', '!']

/**
 * A Roman numeral that a person reads as 2, 3 or 2.5 (II, III, II.V) right after Web, written as the letters I and V that form KD
 * and the table give it. It counts as a word of its own: what follows it is the end of the label or something that is neither a
 * letter nor a digit, so "Web III", "Web Ill" and "Weblll" are read, and "Web Lite", "Web Link" and "Weblink" are not. A number
 * spelled out ("Web Three") is not read: it is the rule's limit.
 */
const NUMERAL = /web[^\p{L}\p{N}]*(?:(iii)|(ii)[^\p{L}\p{N}]*(v)|(ii))(?![\p{L}\p{N}])/gu

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

/** One way a text reads: its letters alone, which a word is looked for in, and the same with a single space where other characters were, which a numeral is looked for in. */
interface Reading {
  readonly letters: string
  readonly spaced: string
}

/** The ways a skeleton can be read: as its characters are and with the letters drawn from punctuation written as letters, each as it is and with its pairs fused. */
function readings (text: string): Reading[] {
  const skeleton = skeletonOf(text).toLowerCase()
  const drawn = DRAWN.reduce((held, [shape, letter]) => held.replace(shape, letter), skeleton)
  return [skeleton, drawn].flatMap((read) => {
    const letters = lettersOf(read)
    const spaced = read.replace(/[^\p{L}\p{N}?!]+/gu, ' ')
    return [{ letters, spaced }, { letters: fused(letters), spaced: fused(spaced) }]
  })
}

const run = (first: number, values: readonly number[]): Array<readonly [string, string]> => values.map((value, at) => [String.fromCodePoint(first + at), String(value)] as const)
const upTo = (count: number, from = 1): number[] => Array.from({ length: count }, (_, at) => from + at)

/** The characters that are a digit or a number and nothing else, each as its digits: the circled, parenthesised and dingbat digits, which form KD leaves alone or, for some, does not reach. The Roman numerals are letters as well, so they are read as the letters form KD gives them. */
const NUMBERS: ReadonlyMap<string, string> = new Map([
  ...run(0x2460, upTo(20)), ...run(0x2474, upTo(20)), ...run(0x2488, upTo(20)), ...run(0x24ea, [0, ...upTo(10, 11)]), ...run(0x24f5, upTo(10)), ...run(0x24ff, [0]),
  ...run(0x2776, upTo(10)), ...run(0x2780, upTo(10)), ...run(0x278a, upTo(10))
])
const NUMBER_CHARS = new RegExp(`[${[...NUMBERS.keys()].join('')}]`, 'gu')

/** Every way `text` reads: with its numbers written as digits, folded as it is and in lower case (the table is case-sensitive), each as its skeleton and as its drawn letters. */
const readingsOf = (text: string): Reading[] => {
  const folded = text.replace(NUMBER_CHARS, (char) => NUMBERS.get(char) ?? char).normalize('NFKD')
  return [folded, folded.toLowerCase()].flatMap(readings)
}

/**
 * What `text` draws as: the forms `reservedWordsIn` reads a label in, for two texts that a person cannot tell apart at a glance
 * to share one. Spacing, case, accents, punctuation, Unicode's lookalike letters and the pairs of characters that draw as one all
 * make no second text.
 */
export const drawnAs = (text: string): string[] => [...new Set(readingsOf(text).map((reading) => reading.letters))]

/** How many characters of a label have their case chosen one by one; each doubles the readings. NFKD writes one character as several (a Roman numeral VIII as four letters), so a short label can hold more. */
const CASE_CHOICES = 8

/**
 * `label` with each character whose reading depends on its case written both ways, in every combination. The table reads a
 * capital I as an "l" and a lower-case one as an "i", and a Greek capital nu as an "n" where its lower case is a "v", so the
 * label as it is and in lower case each get only some of such letters right when a label has more than one.
 */
function casings (label: string): string[] {
  const chars = Array.from(label.normalize('NFKD'))
  const readsByCase = (char: string): boolean => char.toLowerCase() !== char && skeletonOf(char).toLowerCase() !== skeletonOf(char.toLowerCase()).toLowerCase()
  const choices = chars.flatMap((char, at) => (readsByCase(char) ? [at] : [])).slice(0, CASE_CHOICES)
  const written = (mask: number): string => chars.map((char, at) => (choices.includes(at) && ((mask >> choices.indexOf(at)) & 1) === 1 ? char.toLowerCase() : char)).join('')
  return Array.from({ length: 2 ** choices.length }, (_, mask) => written(mask))
}

/**
 * The reserved words a label reads as. The label is folded (compatibility, accents), then read as Unicode's table of
 * lookalikes reads it (confusables.ts), and everything that is not a letter, a digit, "?" or "!" is dropped, so "Web 3",
 * "WEB-3", "Web/3", "Wéb3", the same word wholly in Cyrillic, Greek or Cherokee letters and "WebƷ" all read as `web3`. Two
 * characters that draw as one read as it ("VVeb3", "uueb3", "\/\/eb3", "Waming" for the "rn" of "Warning"), on both sides of the
 * comparison. The table is case-sensitive (a capital "I" is an "l", a Cherokee "Ꮃ" a capital "W"), so the label is read as it is,
 * in lower case, and with the case of each character that depends on it chosen both ways (`casings`); a word found in any
 * reading is found. Every "l" is also read as an "i", since a capital I, a "1" and a "|" all stand for either. Circled and dingbat
 * digits read as their digits, and the Roman numerals II, III and II.V after Web, as a word of their own, as 2, 3 and 2.5. The
 * pairs and the punctuation letters are the ones in use, not every one that could be drawn: README.md's Design notes says what
 * the rest rests on.
 */
export function reservedWordsIn (label: string): string[] {
  const [first = [], ...others] = casings(label).flatMap(readingsOf).map(({ letters, spaced }) => [
    ...(letters.replaceAll('l', 'i').match(RESERVED) ?? []).map((word) => WORD_OF.get(word) ?? word),
    ...Array.from(spaced.replaceAll('l', 'i').matchAll(NUMERAL), ([, three, , five]) => (three !== undefined ? 'web3' : five !== undefined ? 'web25' : 'web2'))
  ])
  return others.every((words) => words.every((word) => first.includes(word))) ? first : [...new Set([first, ...others].flat())]
}
