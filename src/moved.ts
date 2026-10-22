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

/**
 * Each distinct watched name, in the order it first appears. A name is judged when what it serves
 * is among the ids of any evaluation that lists it; `file` is the one of those evaluations judged
 * last, the one a newer build of that name joins.
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
      const latest = items.reduce((a, b) => (b.evaluation.evaluated >= a.evaluation.evaluated ? b : a));
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

/** Where a name is asked: ENS names through the .limo resolver, DNS hosts and ipns:// names through a gateway. */
export const IPNS_GATEWAY = "https://dweb.link/ipns/{name}";

/** The resolver address for one listed name, from the template set for ENS names and the one for the rest. */
export function resolverUrl(listed: string, ensTemplate: string, ipnsTemplate: string): string {
  const bare = listed.replace(/^ipns:\/\//, "");
  const template = listed.startsWith("ipns://") || !bare.endsWith(".eth") ? ipnsTemplate : ensTemplate;
  return template.replaceAll("{name}", bare);
}

/**
 * Reads the root a gateway serves for a name from the first entry of its X-Ipfs-Roots header.
 * With the default ENS template, other names go to the IPNS gateway; a custom template serves all.
 */
export function gatewayResolver(
  ensTemplate: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 60_000,
  ipnsTemplate: string = ensTemplate === DEFAULT_RESOLVER ? IPNS_GATEWAY : ensTemplate,
): Resolve {
  return async (name) => {
    const url = resolverUrl(name, ensTemplate, ipnsTemplate);
    let response: Response;
    try {
      response = await fetchFn(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      const cause = (e as Error & { cause?: unknown }).cause;
      throw new Error(`${url} could not be reached: ${cause instanceof Error ? cause.message : (e as Error).message}`);
    }
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    const root = response.headers.get("x-ipfs-roots")?.split(",")[0]?.trim();
    if (!root) throw new Error(`${url} sent no X-Ipfs-Roots header`);
    const id = canonicalise(`cid:${root}`, "website");
    if (!id.ok) throw new Error(`${url} sent a root that is not a CID: ${root}`);
    return id.id;
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
