// The typed values a mark is made of, read as the Web3 Score format page (docs/architecture/web3-score-provider.md in the
// Orivon repository, section `P/marks.json`) says Orivon reads them. Each rule is Orivon's own, so a file that passes here
// is a file Orivon draws; the tests feed both the same strings. Pure.

/** A mark's id in marks.json and in an evaluation's `mark`. */
export const MARK_ID = /^[a-z][a-z0-9-]{0,23}$/;
export const MAX_LABEL = 12;
export const MAX_NOTE = 300;
export const MAX_ICON_PATH = 1024;
/** Ink on the plate must reach this against the surface, the WCAG ratio for small text. */
export const MIN_CONTRAST = 4.5;
/** The 13% tint of the tone the plate is drawn with over the surface. */
const PLATE_TINT = 0.13;
/** The surfaces ink is measured on: white, and the dark theme's raised surface. */
export const LIGHT_SURFACE = "#ffffff";
export const DARK_SURFACE = "#2b2c31";

/** Control, format (bidirectional, zero-width, tag), surrogate, private-use and unassigned characters, every separator but a plain space, and the blank-looking letters none of those cover. */
const UNSAFE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}͏ᅟᅠ឴឵ㅤﾠ]|(?! )\p{Z}/u;
const HEX_COLOUR = /^#([0-9a-fA-F]{6})$/;

export const isMarkId = (value: unknown): value is string => typeof value === "string" && MARK_ID.test(value);

/** `value` in Unicode form C, or undefined when it is not text, is outside `min` to `max` characters (code points), or holds a character `UNSAFE` names. */
export function plainText(value: unknown, min: number, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.normalize("NFC");
  const length = Array.from(text).length;
  return length >= min && length <= max && !UNSAFE.test(text) ? text : undefined;
}

/**
 * A mark's label, or undefined. It is not blank, has no space at either end, carries no run of three combining marks (which
 * draw far outside the plate), and does not mix Latin, Cyrillic and Greek letters, which draw as each other.
 */
export function markLabel(value: unknown): string | undefined {
  const label = plainText(value, 1, MAX_LABEL);
  if (label === undefined || label !== label.trim() || /\p{M}{3,}/u.test(label)) return undefined;
  const scripts = [/\p{Script=Latin}/u, /\p{Script=Cyrillic}/u, /\p{Script=Greek}/u].filter((script) => script.test(label));
  return scripts.length > 1 ? undefined : label;
}

/** The words Orivon draws itself: the three graded marks, Web?, Unprotected, and the warning and its "!". `web25` is Web2.5 once its dot is gone. */
const RESERVED = /web25|web2|web3|web\?|unprotected|warning|!/g;

/** Letters that draw as a reserved word's letter, digit or sign, each group written as the characters then what they read as. */
const LOOKALIKES: ReadonlyArray<readonly [string, string]> = [
  ["аАαΑᎪᴀ", "a"],
  ["вВβΒᏴʟʙ", "b"],
  ["сСϲϹᴄᏟ", "c"],
  ["ԁԀᎠᴅ", "d"],
  ["еЕεΕᎬᴇ", "e"],
  ["ԌᏀɢ", "g"],
  ["іІιΙɪӀ", "i"],
  ["пηΗɴᎴ", "n"],
  ["оОοΟᴏᎾ", "o"],
  ["рРρΡᴘᏢ", "p"],
  ["гʀᎡ", "r"],
  ["тТτΤᴛᎢ", "t"],
  ["υΥᴜ", "u"],
  ["ԝԜѡѠωᴡᏔᎳ", "w"],
  ["Ƨƨ", "2"],
  ["ƷʒȜȝЗзӠӡҘҙ", "3"],
  ["Ƽƽ", "5"],
  ["؟❓❔՞", "?"],
  ["❗❕ǃ¡❢❣", "!"],
];
const SKELETON = new Map<string, string>(
  LOOKALIKES.flatMap(([chars, reads]) => Array.from(chars).flatMap((char) => [[char, reads] as const, [char.toLowerCase(), reads] as const])),
);

/**
 * The reserved words a label reads as. The label is folded (compatibility, case, accents), each letter that draws as one
 * of a reserved word's characters is read as it, and everything that is not a letter, a digit, "?" or "!" is dropped, so
 * "Web 3", "WEB-3", "Web/3", "Web3" with an accent, the same word wholly in Cyrillic and "WebƷ" all read as `web3`.
 */
export function reservedWordsIn(label: string): string[] {
  const folded = label.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();
  const skeleton = Array.from(folded, (char) => SKELETON.get(char) ?? char)
    .join("")
    .replace(/[^\p{L}\p{N}?!]+/gu, "");
  return skeleton.match(RESERVED) ?? [];
}

/** A colour as `#rrggbb` in lower case, or undefined for any other form (a short hex, an alpha, a name, a function). */
export function colourOf(value: unknown): string | undefined {
  const hex = typeof value === "string" ? HEX_COLOUR.exec(value)?.[1] : undefined;
  return hex === undefined ? undefined : `#${hex.toLowerCase()}`;
}

type Rgb = readonly [number, number, number];

function rgbOf(colour: string): Rgb {
  const packed = parseInt(colour.slice(1), 16);
  return [packed >> 16, (packed >> 8) & 255, packed & 255];
}

function linear(channel: number): number {
  const unit = channel / 255;
  return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

const luminance = ([red, green, blue]: Rgb): number => 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);

/** The WCAG contrast ratio of `ink` on the plate: `tone` at the plate's tint over `surface`. All three are `#rrggbb`. */
export function plateContrast(tone: string, ink: string, surface: string): number {
  const [surfaceRed, surfaceGreen, surfaceBlue] = rgbOf(surface);
  const [toneRed, toneGreen, toneBlue] = rgbOf(tone);
  const tinted = (under: number, over: number): number => under * (1 - PLATE_TINT) + over * PLATE_TINT;
  const plate = luminance([tinted(surfaceRed, toneRed), tinted(surfaceGreen, toneGreen), tinted(surfaceBlue, toneBlue)]);
  const text = luminance(rgbOf(ink));
  return (Math.max(plate, text) + 0.05) / (Math.min(plate, text) + 0.05);
}

/** Arguments in one group of each path command; the commands are SVG's, with no exponent form and no unit. */
const ARGUMENTS: Readonly<Record<string, number>> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
const NUMBER = /-?(?:\d+\.?\d*|\.\d+)/y;
const MAX_COORDINATE = 100;
const MAX_ROTATION = 360;

/**
 * One SVG path `d` for a 24 by 24 view box, or undefined. Only SVG's path commands and plain decimal numbers of a bounded
 * size are read; the path is written back as commands and numbers alone, one group to a command, so a file carries the
 * same path Orivon draws.
 */
export function iconPathOf(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ICON_PATH) return undefined;
  const at = { i: 0 };
  const skip = (): void => {
    while (at.i < value.length && " \t\n\r,".includes(value.charAt(at.i))) at.i++;
  };
  const number = (bound: number): number | undefined => {
    NUMBER.lastIndex = at.i;
    const found = NUMBER.exec(value);
    if (found === null) return undefined;
    at.i += found[0].length;
    const read = Number(found[0]);
    return Number.isFinite(read) && Math.abs(read) <= bound ? read : undefined;
  };
  // An arc's two flags are one digit each and may run into the next number.
  const flag = (): number | undefined => {
    const read = value.charAt(at.i);
    at.i++;
    return read === "0" || read === "1" ? Number(read) : undefined;
  };
  const out: string[] = [];
  let command = "";
  for (skip(); at.i < value.length; skip()) {
    const next = value.charAt(at.i);
    if (/[A-Za-z]/.test(next)) {
      command = next;
      at.i++;
    }
    const arity = ARGUMENTS[command.toUpperCase()];
    if (arity === undefined || (out.length === 0 && command !== "M" && command !== "m")) return undefined;
    if (arity === 0) {
      out.push(command);
      command = "";
      continue;
    }
    const isArc = command === "A" || command === "a";
    const group: number[] = [];
    for (let k = 0; k < arity; k++) {
      skip();
      const read = isArc && (k === 3 || k === 4) ? flag() : number(isArc && k === 2 ? MAX_ROTATION : MAX_COORDINATE);
      if (read === undefined) return undefined;
      group.push(read);
    }
    out.push(`${command}${group.map((n) => ` ${String(Math.round(n * 1000) / 1000)}`).join("")}`);
    // The pairs after a moveto are linetos.
    if (command === "M") command = "L";
    else if (command === "m") command = "l";
  }
  return out.length > 0 ? out.join(" ") : undefined;
}
