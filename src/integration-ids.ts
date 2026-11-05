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

/** Orivon's default for where a declaration runs when it does not say: a page, a component, or data it only reads. */
function hostingOf(declaration: Fields): string {
  if (typeof declaration.hosting === "string") return declaration.hosting;
  switch (declaration.type) {
    case "data-gathering":
      return declaration.entry === undefined && declaration.module === undefined ? "data" : "page";
    case "library":
      return "component";
    case "web3-score":
    case "standard":
    case "catalogue":
    case "search":
      return "data";
    default:
      return "page";
  }
}

/** Whether a declaration brings a file of its own, as Orivon counts them: a page entry, a component or standard module, a network node's runner, a panel. Everything else is data Orivon reads. */
function bringsFile(declaration: Fields): boolean {
  if (declaration.type === "library" || declaration.type === "extension") return false;
  const hosting = hostingOf(declaration);
  return (
    (hosting === "page" && declaration.entry !== undefined) ||
    (hosting === "component" && declaration.module !== undefined) ||
    (declaration.type === "network-node" && declaration.runner !== undefined) ||
    (declaration.type === "standard" && declaration.module !== undefined) ||
    declaration.panel !== undefined
  );
}

const declarationId = (declaration: Fields): string => {
  const checked = canonicalise(`integration:decl:${createHash("sha256").update(canonicalJson(declaration)).digest("hex")}`, "integration");
  if (!checked.ok) throw new UserError(`${String(declaration.id)}: ${checked.message}`);
  return checked.id;
};

/**
 * The identifiers a provider files one declared integration under (the format page's Integration identifiers section).
 * A library or an extension is one file, filed by its own hash. In a site whose bundle is pinned (some integration of
 * it brings a file), the others are filed under the bundle hash and their declaration id, and one that brings no file of
 * its own is also looked up by the SHA-256 of its declaration; the two forms come space-separated. In a site with no
 * file to pin, a data-only integration is filed by the declaration hash alone.
 */
export function integrationIdOf(declaration: Fields, bundleHash: string, pinned = true): string {
  const id = declaration.id;
  if (typeof id !== "string") throw new UserError("an integration declares no id");
  const type = declaration.type;
  const hash = declaration.hash;
  if (type === "library" || type === "extension") {
    if (typeof hash !== "string" || !FILE_HASH.test(hash)) throw new UserError(`${id}: a ${type} declares the SHA-256 of its file as 64 lowercase hex characters in hash`);
    const checked = canonicalise(`sha256:${hash}`, "integration");
    if (!checked.ok) throw new UserError(`${id}: ${checked.message}`);
    return checked.id;
  }
  if (!pinned) return declarationId(declaration);
  const checked = canonicalise(`integration:${bundleHash.slice("sha256:".length)}#${id}`, "integration");
  if (!checked.ok) throw new UserError(`${id}: ${checked.message}`);
  return bringsFile(declaration) ? checked.id : `${checked.id} ${declarationId(declaration)}`;
}

/** The identifiers of every integration the app in `staticDir` declares, in the order its manifest lists them. */
export function integrationIds(staticDir: string): string[] {
  const bundleHash = readBundleHash(staticDir);
  const file = path.join(staticDir, ".well-known", "orivon.json");
  const read = readJson(file);
  if (read.issue) throw new UserError(formatIssue(read.issue));
  const declared = isFields(read.value) ? read.value.integrations : undefined;
  if (!Array.isArray(declared) || declared.length === 0) throw new UserError(`${file} declares no integrations`);
  const fields = declared.map((item, i) => {
    if (!isFields(item)) throw new UserError(`${file}: integrations[${i}] must be an object`);
    return item;
  });
  const pinned = fields.some(bringsFile);
  return fields.map((item) => integrationIdOf(item, bundleHash, pinned));
}
