import { canonicalise } from "./identifiers.ts";
import type { LoadedEvaluation } from "./source.ts";

/** Asked for each name with `{name}` replaced; eth.limo resolves ENS, IPNS and DNSLink in one request. */
export const DEFAULT_RESOLVER = "https://{name}.limo/";

/** The build a name serves now, as a canonical `cid:` identifier. */
export type Resolve = (name: string) => Promise<string>;

export type NameState =
  | { kind: "judged"; name: string; file: string }
  | { kind: "moved"; name: string; file: string; now: string }
  | { kind: "unresolved"; name: string; file: string; reason: string };

/** Each watched name of each evaluation, in file order, compared with the ids that evaluation judges. */
export async function checkNames(evaluations: LoadedEvaluation[], resolve: Resolve, parallel = 4): Promise<NameState[]> {
  const jobs = evaluations.flatMap((item) => (item.evaluation.names ?? []).map((name) => ({ name, item })));
  const states: NameState[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < jobs.length) {
      const at = next++;
      const { name, item } = jobs[at]!;
      try {
        const now = await resolve(name);
        states[at] = item.evaluation.ids.includes(now)
          ? { kind: "judged", name, file: item.file }
          : { kind: "moved", name, file: item.file, now };
      } catch (e) {
        states[at] = { kind: "unresolved", name, file: item.file, reason: (e as Error).message };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, jobs.length) }, worker));
  return states;
}

/** Reads the root a gateway serves for a name from the first entry of its X-Ipfs-Roots header. */
export function gatewayResolver(template: string, fetchFn: typeof fetch = fetch, timeoutMs = 60_000): Resolve {
  return async (name) => {
    const url = template.replaceAll("{name}", name);
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
