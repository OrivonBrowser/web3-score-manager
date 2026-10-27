import { canonicalise } from "./identifiers.ts";
import type { LoadedEvaluation } from "./source.ts";

/** Asked for each ENS name with `{name}` replaced. */
export const DEFAULT_RESOLVER = "https://{name}.limo/";

/** The build a name serves now, as a canonical `cid:` identifier. */
export type Resolve = (name: string) => Promise<string>;

export type NameState =
  | { kind: "judged"; name: string; file: string }
  | { kind: "moved"; name: string; file: string; now: string }
  | { kind: "unresolved"; name: string; file: string; reason: string };

/** The position of an evaluation file among those of one app: `explore-2.json` follows `explore.json`, which counts as 1. */
const order = (file: string): number => Number(/-(\d+)\.json$/.exec(file)?.[1] ?? 1);

/**
 * Each distinct watched name, in the order it first appears. A name is judged when what it serves
 * is among the ids of any evaluation that lists it. `file` is the evaluation that judges it, or, for
 * a moved or unresolved name, the one judged last, which a newer build joins.
 */
export async function checkNames(evaluations: LoadedEvaluation[], resolve: Resolve, parallel = 4): Promise<NameState[]> {
  const byName = new Map<string, LoadedEvaluation[]>();
  for (const item of evaluations) {
    for (const name of item.evaluation.names ?? []) byName.set(name, [...(byName.get(name) ?? []), item]);
  }
  const jobs = [...byName].map(([name, items]) => ({ name, items }));
  const states: NameState[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < jobs.length) {
      const at = next++;
      const { name, items } = jobs[at]!;
      const latest = items.reduce((a, b) =>
        b.evaluation.evaluated > a.evaluation.evaluated || (b.evaluation.evaluated === a.evaluation.evaluated && order(b.file) >= order(a.file)) ? b : a);
      try {
        const now = await resolve(name);
        const judging = items.find((item) => item.evaluation.ids.includes(now));
        states[at] = judging ? { kind: "judged", name, file: judging.file } : { kind: "moved", name, file: latest.file, now };
      } catch (e) {
        states[at] = { kind: "unresolved", name, file: latest.file, reason: (e as Error).message };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, jobs.length) }, worker));
  return states;
}

/** Asked for the `_dnslink` TXT record of DNS hosts and `ipns://<host>` names, through DNS over HTTPS (JSON form). */
export const DEFAULT_DNSLINK_RESOLVER = "https://cloudflare-dns.com/dns-query";

const IPNS_SCHEME = "ipns://";
const TXT = 16;

/** The resolver address for one listed name: the template with `{name}` replaced by the name without its scheme. */
export function resolverUrl(listed: string, template: string): string {
  return template.replaceAll("{name}", listed.replace(/^ipns:\/\//, ""));
}

/** The DNS-over-HTTPS query for the DNSLink record of a host. */
export function dnslinkUrl(host: string, endpoint: string): string {
  const url = new URL(endpoint);
  url.searchParams.set("name", `_dnslink.${host}`);
  url.searchParams.set("type", "TXT");
  return url.toString();
}

async function fetchOrExplain(fetchFn: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchFn(url, init);
  } catch (e) {
    const cause = (e as Error & { cause?: unknown }).cause;
    throw new Error(`${url} could not be reached: ${cause instanceof Error ? cause.message : (e as Error).message}`);
  }
}

function rootOf(url: string, root: string): string {
  const id = canonicalise(`cid:${root}`, "website");
  if (!id.ok) throw new Error(`${url} sent a root that is not a CID: ${root}`);
  return id.id;
}

/** The value of the first `dnslink=` string among the TXT answers, with the quotes of the DoH JSON form removed. */
function dnslinkValue(body: unknown): string | undefined {
  const answers = (body as { Answer?: { type?: number; data?: unknown }[] } | null)?.Answer;
  for (const answer of Array.isArray(answers) ? answers : []) {
    if (answer.type !== TXT || typeof answer.data !== "string") continue;
    const text = answer.data.replace(/^"|"$/g, "").replaceAll('" "', "");
    if (text.startsWith("dnslink=")) return text.slice("dnslink=".length);
  }
  return undefined;
}

/**
 * Reads the build a name serves now. ENS names go to the template, from the first entry of the
 * X-Ipfs-Roots header it answers with. DNS hosts and `ipns://<host>` names are read from the host's
 * DNSLink record, which must be `/ipfs/<cid>`; an `ipns://` key or a `/ipns/` record is unresolved.
 * A template other than the default is asked for every form.
 */
export function gatewayResolver(
  ensTemplate: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 60_000,
  dnslinkEndpoint: string = DEFAULT_DNSLINK_RESOLVER,
): Resolve {
  const viaTemplate = async (name: string): Promise<string> => {
    const url = resolverUrl(name, ensTemplate);
    const response = await fetchOrExplain(fetchFn, url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    const root = response.headers.get("x-ipfs-roots")?.split(",")[0]?.trim();
    if (!root) throw new Error(`${url} sent no X-Ipfs-Roots header`);
    return rootOf(url, root);
  };
  const viaDnslink = async (host: string): Promise<string> => {
    const url = dnslinkUrl(host, dnslinkEndpoint);
    const response = await fetchOrExplain(fetchFn, url, { headers: { accept: "application/dns-json" }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error(`${url} did not answer in the DNS JSON form`);
    }
    const value = dnslinkValue(body);
    if (value === undefined) throw new Error(`${host} has no DNSLink record`);
    const match = /^\/ipfs\/([^/]+)/.exec(value);
    if (!match) throw new Error(`the DNSLink record of ${host} is ${value}, not an /ipfs/ address`);
    return rootOf(url, match[1]!);
  };
  return async (name) => {
    if (ensTemplate !== DEFAULT_RESOLVER) return viaTemplate(name);
    const bare = name.startsWith(IPNS_SCHEME) ? name.slice(IPNS_SCHEME.length) : name;
    if (name.startsWith(IPNS_SCHEME) && /^k51/.test(bare)) throw new Error("an ipns:// key is not resolved: no gateway is asked for it");
    return name.startsWith(IPNS_SCHEME) || !name.endsWith(".eth") ? viaDnslink(bare) : viaTemplate(name);
  };
}

/** The report `moved` prints, and whether it should fail: a name moved, or no name resolved at all. */
export function report(states: NameState[]): { text: string; failed: boolean } {
  const count = (kind: NameState["kind"]) => states.filter((s) => s.kind === kind).length;
  const lines = states.flatMap((s) => {
    if (s.kind === "moved") return [`moved       ${s.name}  now ${s.now}  (${s.file})`];
    if (s.kind === "unresolved") return [`unresolved  ${s.name}  ${s.reason}  (${s.file})`];
    return [];
  });
  lines.push(`${states.length} names: ${count("judged")} serve a judged build, ${count("moved")} moved, ${count("unresolved")} unresolved`);
  const failed = count("moved") > 0 || (states.length > 0 && count("unresolved") === states.length);
  return { text: `${lines.join("\n")}\n`, failed };
}
