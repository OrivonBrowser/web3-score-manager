export interface ProbeSummary {
  renders: boolean;
  thirdParty: { origins: string[]; scripts: string[]; frames: string[] };
}

function strings(value: unknown, max = 200): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value.slice(0, max)) {
    if (typeof item !== "string") return null;
    out.push(item.slice(0, 300));
  }
  return out;
}

/** probe.json was written by code that ran next to the site: only the few fields the watch acts on are read, and checked. */
export function parseProbe(text: string): ProbeSummary | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const raw = value as { renders?: unknown; thirdParty?: { origins?: unknown; scripts?: unknown; frames?: unknown } };
  if (typeof raw.renders !== "boolean" || typeof raw.thirdParty !== "object" || raw.thirdParty === null) return null;
  const origins = strings(raw.thirdParty.origins);
  const scripts = strings(raw.thirdParty.scripts);
  const frames = strings(raw.thirdParty.frames);
  if (!origins || !scripts || !frames) return null;
  return { renders: raw.renders, thirdParty: { origins, scripts, frames } };
}
