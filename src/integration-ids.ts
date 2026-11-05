import { createHash } from "node:crypto";
import path from "node:path";
import { canonicalise } from "./identifiers.ts";
import { readBundleHash } from "./manage.ts";
import { readJson } from "./source.ts";
import { UserError, formatIssue } from "./types.ts";

const FILE_HASH = /^[0-9a-f]{64}$/;

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value);

/** Keys in UTF-16 code-unit order at every level and no whitespace, the text Orivon hashes a declaration as. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isFields(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Whether a declaration brings a file of its own: the page, module or package it runs. Everything else is data Orivon reads. */
const bringsFile = (declaration: Fields): boolean => ["entry", "module", "crx"].some((key) => declaration[key] !== undefined);

/**
 * The identifier a provider files one declared integration under (the format page's Integration identifiers section):
 * a library or an extension is one file, filed by its own hash; one that brings files is filed under the bundle hash
 * of the site that carries it and its declaration id; a data-only declaration is filed by the SHA-256 of the declaration.
 */
export function integrationIdOf(declaration: Fields, bundleHash: string): string {
  const id = declaration.id;
  if (typeof id !== "string") throw new UserError("an integration declares no id");
  const type = declaration.type;
  const hash = declaration.hash;
  let raw: string;
  if (type === "library" || type === "extension") {
    if (typeof hash !== "string" || !FILE_HASH.test(hash)) throw new UserError(`${id}: a ${type} declares the SHA-256 of its file as 64 lowercase hex characters in hash`);
    raw = `sha256:${hash}`;
  } else if (bringsFile(declaration)) {
    raw = `integration:${bundleHash.slice("sha256:".length)}#${id}`;
  } else {
    raw = `integration:decl:${createHash("sha256").update(canonicalJson(declaration)).digest("hex")}`;
  }
  const checked = canonicalise(raw, "integration");
  if (!checked.ok) throw new UserError(`${id}: ${checked.message}`);
  return checked.id;
}

/** The identifiers of every integration the app in `staticDir` declares, in the order its manifest lists them. */
export function integrationIds(staticDir: string): string[] {
  const bundleHash = readBundleHash(staticDir);
  const file = path.join(staticDir, ".well-known", "orivon.json");
  const read = readJson(file);
  if (read.issue) throw new UserError(formatIssue(read.issue));
  const declared = isFields(read.value) ? read.value.integrations : undefined;
  if (!Array.isArray(declared) || declared.length === 0) throw new UserError(`${file} declares no integrations`);
  return declared.map((item, i) => {
    if (!isFields(item)) throw new UserError(`${file}: integrations[${i}] must be an object`);
    return integrationIdOf(item, bundleHash);
  });
}
