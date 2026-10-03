import { CID } from "multiformats/cid";
import type { Subject } from "./types.ts";

export type IdType = "sha256" | "cid" | "caip10" | "caip2" | "origin";

export const ID_TYPES: Record<Subject, readonly IdType[]> = {
  website: ["sha256", "cid"],
  operation: ["caip10"],
  connection: ["caip2", "origin"],
};

const CAIP10 = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}:[-.%a-zA-Z0-9]{1,128}$/;
const CAIP2 = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/;
const SHA256 = /^[0-9a-fA-F]{64}$/;
const ORIGIN = /^https:\/\/[^/?#@\s\\]+$/;

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
