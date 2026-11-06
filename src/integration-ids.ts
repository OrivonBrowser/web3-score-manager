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

// The members Orivon's manifest reader accepts in a declaration, and in the objects inside one. A declaration with any
// other member is skipped there, so it has no identifier. `icon` is checked and not kept.
const COMMON_KEYS = ["id", "name", "hosting", "entry", "module", "hash", "export", "onTheFly", "background", "uses", "panel", "icon"];
const TYPE_KEYS: Readonly<Record<string, readonly string[]>> = {
  account: ["type", "descriptors", "hid"],
  crypto: ["type", "codes"],
  "address-list": ["type", "codes"],
  payment: ["type", "legs"],
  "network-node": ["type", "codes", "local", "runner"],
  tunnel: ["type", "kinds"],
  "name-resolution": ["type", "namespaces"],
  "data-gathering": ["type", "records", "endpoint"],
  "web3-score": ["type", "address", "outputs"],
  extension: ["type", "crx", "hash"],
  library: ["type", "library", "module", "hash"],
  standard: ["type", "code", "module", "hash"],
  catalogue: ["type", "feed"],
  dashboard: ["type"],
  search: ["type", "url", "suggest"],
  "link-scheme": ["type", "schemes"],
};
const USE_KEYS = ["code", "optional", "why"];
const DESCRIPTOR_KEYS = ["algorithm", "key", "context"];
const DESCRIPTOR_SECTION_KEYS: Readonly<Record<string, readonly string[]>> = {
  algorithm: ["mode", "scheme", "capabilities"],
  key: ["keyList", "held", "transport"],
  context: ["chain", "network", "maxPayloadSize"],
};
const HID_FILTER_KEYS = ["vendorId", "productId", "usagePage", "usage"];

const HOSTINGS = ["page", "component", "data"];
/** An id as Orivon's manifest reader takes it, which is narrower than the identifier form: lower-case letters, digits and hyphens, the first a letter. */
const DECLARED_ID = /^[a-z][a-z0-9-]*$/;
const MAX_DECLARED_ID = 40;
/** The start of the id of the row Orivon makes for an app a person chose to take a scheme's links: a manifest's link-scheme entry may not use it. */
const CHOICE_ROW_ID_PREFIX = "links-";
/** How many declarations a manifest may make before Orivon ignores the whole field. */
const MAX_DECLARATIONS = 16;

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** The declaration as Orivon's manifest reader returns it, or an error saying why the reader skips it. */
function asRead(declaration: Fields): Fields {
  const label = String(declaration.id);
  const type = declaration.type;
  const typeKeys = typeof type === "string" && Object.hasOwn(TYPE_KEYS, type) ? TYPE_KEYS[type]! : undefined;
  if (typeKeys === undefined) throw new UserError(`${label}: Orivon's manifest reader skips a declaration of type ${JSON.stringify(type)}, which it does not know`);
  if (!DECLARED_ID.test(label) || label.length > MAX_DECLARED_ID) {
    throw new UserError(`${label}: Orivon's manifest reader refuses this id: lower-case letters, digits and hyphens, the first a letter, at most ${MAX_DECLARED_ID} characters`);
  }
  if (type === "link-scheme" && label.startsWith(CHOICE_ROW_ID_PREFIX)) {
    throw new UserError(`${label}: Orivon's manifest reader skips a link-scheme whose id starts with "${CHOICE_ROW_ID_PREFIX}", which it keeps for the row of an app the person chose`);
  }
  if (declaration.hosting !== undefined && !HOSTINGS.includes(String(declaration.hosting))) {
    throw new UserError(`${label}: Orivon's manifest reader skips this declaration: hosting is ${JSON.stringify(declaration.hosting)}, not one of ${HOSTINGS.join(", ")}`);
  }
  const only = (value: unknown, allowed: readonly string[], where: string): void => {
    if (!isFields(value)) return;
    const stray = Object.keys(value).find((key) => !allowed.includes(key));
    if (stray !== undefined) throw new UserError(`${label}: Orivon's manifest reader skips this declaration: ${where} has the unrecognised field ${JSON.stringify(stray)}`);
  };
  only(declaration, [...COMMON_KEYS, ...typeKeys], "the declaration");
  for (const use of listOf(declaration.uses)) only(use, USE_KEYS, "a use");
  for (const descriptor of listOf(declaration.descriptors)) {
    only(descriptor, DESCRIPTOR_KEYS, "a descriptor");
    if (!isFields(descriptor)) continue;
    for (const [section, keys] of Object.entries(DESCRIPTOR_SECTION_KEYS)) only(descriptor[section], keys, `a descriptor's ${section}`);
  }
  for (const filter of listOf(declaration.hid)) only(filter, HID_FILTER_KEYS, "a hid filter");
  return Object.fromEntries(Object.entries(declaration).filter(([key]) => key !== "icon"));
}

/** The SHA-256 of a declaration's canonical JSON as Orivon's manifest reader returns it: 64 lower-case hex characters. */
export function declarationHashOf(declaration: Fields): string {
  return createHash("sha256").update(canonicalJson(asRead(declaration))).digest("hex");
}

/** Where a declaration runs when it does not say, as Orivon reads it: a page, a component, or data it only reads. An extension has none. */
function hostingOf(declaration: Fields): string | undefined {
  if (declaration.type === "extension") return undefined;
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

/** Whether a declaration brings a file of the site's bundle, as Orivon counts them: a page entry, a component or standard module, a network node's runner, an extension's package, a panel. */
function bringsFile(declaration: Fields): boolean {
  const hosting = hostingOf(declaration);
  return (
    (hosting === "page" && declaration.entry !== undefined) ||
    (hosting === "component" && declaration.module !== undefined) ||
    (declaration.type === "network-node" && declaration.runner !== undefined) ||
    (declaration.type === "extension" && declaration.crx !== undefined) ||
    (declaration.type === "standard" && declaration.module !== undefined) ||
    declaration.panel !== undefined
  );
}

/** Whether a declaration is only data: hosted as data, with no file of its own that it pins by a hash. */
const isCodeless = (declaration: Fields): boolean => hostingOf(declaration) === "data" && declaration.hash === undefined;

/** Whether installing the site pins its bundle: some declaration brings a file, and not every one is a library, which is kept by its hash. */
export function bundlePinned(declarations: readonly Fields[]): boolean {
  return declarations.some(bringsFile) && declarations.some((declaration) => declaration.type !== "library");
}

const declarationId = (declaration: Fields): string => {
  const checked = canonicalise(`integration:decl:${declarationHashOf(declaration)}`, "integration");
  if (!checked.ok) throw new UserError(`${String(declaration.id)}: ${checked.message}`);
  return checked.id;
};

/**
 * The identifier a provider files one declared integration under: the first of the format page's Integration
 * identifiers section that fits. A library or an extension is its file; a declaration of only data is the SHA-256 of
 * the declaration, whatever its site pinned; any other integration of a site whose bundle is pinned is the bundle's and
 * its declaration id; one with only a file of its own is that file; one with neither is its declaration.
 */
export function integrationIdOf(declaration: Fields, bundleHash: string, pinned = true): string {
  const id = declaration.id;
  if (typeof id !== "string") throw new UserError("an integration declares no id");
  asRead(declaration);
  const type = declaration.type;
  const hash = declaration.hash;
  const file = typeof hash === "string" && FILE_HASH.test(hash) ? canonicalise(`sha256:${hash}`, "integration") : undefined;
  if (type === "library" || type === "extension") {
    if (file === undefined) throw new UserError(`${id}: a ${type} declares the SHA-256 of its file as 64 lowercase hex characters in hash`);
    if (!file.ok) throw new UserError(`${id}: ${file.message}`);
    return file.id;
  }
  if (isCodeless(declaration)) return declarationId(declaration);
  if (pinned) {
    const checked = canonicalise(`integration:${bundleHash.slice("sha256:".length)}#${id}`, "integration");
    if (!checked.ok) throw new UserError(`${id}: ${checked.message}`);
    return checked.id;
  }
  if (file?.ok === true) return file.id;
  return declarationId(declaration);
}

/** The identifiers of every integration the app in `staticDir` declares, one for each, in the order its manifest lists them. */
export function integrationIds(staticDir: string): string[] {
  const bundleHash = readBundleHash(staticDir);
  const file = path.join(staticDir, ".well-known", "orivon.json");
  const read = readJson(file);
  if (read.issue) throw new UserError(formatIssue(read.issue));
  const declared = isFields(read.value) ? read.value.integrations : undefined;
  if (!Array.isArray(declared) || declared.length === 0) throw new UserError(`${file} declares no integrations`);
  if (declared.length > MAX_DECLARATIONS) throw new UserError(`${file} declares ${declared.length} integrations, more than the ${MAX_DECLARATIONS} Orivon reads: it ignores the whole field`);
  const fields = declared.map((item, i) => {
    if (!isFields(item)) throw new UserError(`${file}: integrations[${i}] must be an object`);
    return item;
  });
  const repeated = fields.find((item, i) => fields.findIndex((other) => other.id === item.id) !== i);
  if (repeated !== undefined) throw new UserError(`${file}: the id ${JSON.stringify(repeated.id)} is declared twice, and Orivon refuses a manifest that repeats one`);
  const pinned = bundlePinned(fields);
  return fields.map((item) => integrationIdOf(item, bundleHash, pinned));
}
