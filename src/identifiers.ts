import { CID } from "multiformats/cid";
import type { Subject } from "./types.ts";

export type IdType = "sha256" | "cid" | "arw" | "btmh" | "btih" | "caip10" | "caip2" | "origin" | "integration";

/**
 * Orivon files an installed integration's connection rating under the `sha256:` bundle hash of what it pinned, and under `cid:`
 * once the install record carries the root; an integration's own verdict is filed under `integration:` or the `sha256:` of its file.
 */
export const ID_TYPES: Record<Subject, readonly IdType[]> = {
  website: ["sha256", "cid", "arw", "btmh", "btih"],
  operation: ["caip10"],
  connection: ["sha256", "cid", "caip2", "origin"],
  integration: ["integration", "sha256"],
};

const CAIP10 = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}:[-.%a-zA-Z0-9]{1,128}$/;
const CAIP2 = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/;
const SHA256 = /^[0-9a-fA-F]{64}$/;
// arw, btmh and btih are written exactly as the standard's Identifiers table says, as Orivon looks them up:
// another case, length, padding or alphabet is not that type, so none is rewritten.
const ARWEAVE_ID = /^[A-Za-z0-9_-]{43}$/;
/** A SHA-256 multihash: code 0x12, length 0x20, then the 32-byte digest. */
const TORRENT_MULTIHASH = /^1220[0-9a-f]{64}$/;
const TORRENT_INFOHASH = /^[0-9a-f]{40}$/;
const ORIGIN = /^https:\/\/[^/?#@\s\\]+$/;
/** What an integration's principal accepts as a declaration id; a built-in's name is written in the same characters. */
const DECLARATION_ID = "[a-z0-9][a-z0-9._-]{0,63}";
// The forms of an `integration:` value, written exactly as the format page's Integration identifiers section says: the
// bundle form, a built-in's row, and the SHA-256 of a data-only integration's declaration (the one with no file of its own).
const INTEGRATION_BUNDLE = new RegExp(`^[0-9a-f]{64}#${DECLARATION_ID}$`);
const INTEGRATION_BUILTIN = new RegExp(`^builtin:${DECLARATION_ID}$`);
const INTEGRATION_DECLARATION = /^decl:[0-9a-f]{64}$/;

export type Canonical = { ok: true; id: string; type: IdType } | { ok: false; message: string };

function fail(message: string): Canonical {
  return { ok: false, message };
}

/** Checks one identifier against its type's rules and returns its canonical spelling. */
export function canonicalise(raw: string, subject: Subject): Canonical {
  if (!/^[\x21-\x7e]+$/.test(raw)) return fail("an identifier is ASCII with no whitespace");
  const colon = raw.indexOf(":");
  if (colon < 1) return fail('an identifier is "<type>:<value>"');
  const type = raw.slice(0, colon);
  const value = raw.slice(colon + 1);
  const allowed = ID_TYPES[subject];
  if (!allowed.includes(type as IdType)) {
    return fail(`identifier type "${type}" is not allowed on a ${subject} (allowed: ${allowed.join(", ")})`);
  }
  switch (type as IdType) {
    case "sha256":
      if (!SHA256.test(value)) return fail("sha256 needs 64 hex characters");
      return { ok: true, type: "sha256", id: `sha256:${value.toLowerCase()}` };
    case "cid":
      try {
        return { ok: true, type: "cid", id: `cid:${CID.parse(value).toV1().toString()}` };
      } catch {
        return fail("cid is not a parseable CIDv0 or base32 CIDv1");
      }
    case "arw":
      if (!ARWEAVE_ID.test(value)) return fail("arw is an Arweave transaction id: 43 characters of base64url, exactly");
      return { ok: true, type: "arw", id: raw };
    case "btmh":
      if (!TORRENT_MULTIHASH.test(value)) return fail("btmh is lowercase hex: 1220 and 64 hex characters, 68 in all");
      return { ok: true, type: "btmh", id: raw };
    case "btih":
      if (!TORRENT_INFOHASH.test(value)) return fail("btih is lowercase hex: 40 characters");
      return { ok: true, type: "btih", id: raw };
    case "integration":
      if (!INTEGRATION_BUNDLE.test(value) && !INTEGRATION_BUILTIN.test(value) && !INTEGRATION_DECLARATION.test(value)) {
        return fail(
          "integration is <64 lowercase hex>#<declaration id>, builtin:<name>, or decl:<64 lowercase hex>; a declaration id is lowercase letters, digits, . _ and -, at most 64, the first a letter or digit",
        );
      }
      return { ok: true, type: "integration", id: raw };
    case "caip10":
      if (!CAIP10.test(value)) return fail("caip10 must look like eip155:1:0xab...");
      return { ok: true, type: "caip10", id: raw };
    case "caip2":
      if (!CAIP2.test(value)) return fail("caip2 must look like eip155:1");
      return { ok: true, type: "caip2", id: raw };
    case "origin": {
      if (!ORIGIN.test(value)) return fail("origin must be https://host[:port] with nothing after it");
      try {
        const url = new URL(value);
        if (url.username || url.password) return fail("origin carries no credentials");
        return { ok: true, type: "origin", id: `origin:${url.origin}` };
      } catch {
        return fail("origin is not a valid https origin");
      }
    }
  }
}
