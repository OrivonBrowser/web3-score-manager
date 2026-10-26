import path from "node:path";
import type { Part, SourceEvaluation } from "../src/types.ts";
import type { ProbeSummary } from "./probe-result.ts";
import type { Verdict, VerdictPart } from "./verdict.ts";

const MAX_IDS = 8;

/** Whether judging `newId` needs a new evaluation file: this one already holds the most ids an evaluation may. */
export function startsNewFile(old: SourceEvaluation, newId: string): boolean {
  return old.ids.length >= MAX_IDS && !old.ids.includes(newId);
}

function nextIds(old: string[], newId: string): string[] {
  const kept = old.filter((id) => id !== newId);
  return kept.length >= MAX_IDS ? [newId] : [...kept, newId];
}

/** The first `<base>-<n>.json` beside `file` that `exists` does not report, n from 2; a trailing `-<n>` of the old name is not stacked. */
export function newEvaluationFile(file: string, exists: (candidate: string) => boolean): string {
  const slug = path.basename(file, ".json").replace(/-\d+$/, "");
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = path.join(path.dirname(file), `${slug.slice(0, 64 - suffix.length).replace(/-+$/, "")}${suffix}.json`);
    if (!exists(candidate)) return candidate;
  }
}

function partsOf(list: VerdictPart[]): Part[] {
  return list.map((p) => {
    const part: Part = { name: p.name, trustlessity: { level: p.level, privacy: p.privacy === true } };
    if (p.note !== undefined && p.note !== "") part.note = p.note;
    return part;
  });
}

/**
 * The old evaluation with the judge's reading of the new build: ids, names and subject stay the watch's own.
 * An evaluation that already holds eight ids is not trimmed: the result lists only the new build, to be written
 * as a new file (`startsNewFile`) that lists the same names.
 */
export function mergeEvaluation(old: SourceEvaluation, v: Verdict, newCid: string, today: string): SourceEvaluation {
  const merged: SourceEvaluation = {
    subject: old.subject,
    ids: nextIds(old.ids, `cid:${newCid}`),
    name: v.name,
    evaluated: today,
    trustlessity: { level: v.level, privacy: v.privacy },
  };
  if (old.names !== undefined) merged.names = old.names;
  if (v.version !== undefined && v.version !== "") merged.version = v.version;
  merged.summary = v.summary;
  if (v.operations.length > 0) merged.operations = partsOf(v.operations);
  if (v.connections.length > 0) merged.connections = partsOf(v.connections);
  const evidence = v.evidence.length > 0 ? v.evidence : (old.evidence ?? []);
  if (evidence.length > 0) merged.evidence = evidence;
  return merged;
}

function orderedPart(p: Part): Record<string, unknown> {
  const level = p.trustlessity.privacy ? { level: p.trustlessity.level, privacy: true } : { level: p.trustlessity.level };
  const out: Record<string, unknown> = { name: p.name, trustlessity: level };
  if (p.note !== undefined) out.note = p.note;
  if (p.id !== undefined) out.id = p.id;
  return out;
}

/** The file as the repository keeps it: fixed key order, two-space indent, a final newline. */
export function serialiseEvaluation(e: SourceEvaluation): string {
  const out: Record<string, unknown> = { subject: e.subject, ids: e.ids };
  if (e.names !== undefined) out.names = e.names;
  out.name = e.name;
  if (e.version !== undefined) out.version = e.version;
  out.evaluated = e.evaluated;
  out.trustlessity = e.trustlessity;
  if (e.summary !== undefined) out.summary = e.summary;
  if (e.operations !== undefined) out.operations = e.operations.map(orderedPart);
  if (e.connections !== undefined) out.connections = e.connections.map(orderedPart);
  if (e.evidence !== undefined) out.evidence = e.evidence;
  return `${JSON.stringify(out, null, 2)}\n`;
}

export interface Decision {
  action: "apply" | "hold" | "reject";
  reasons: string[];
}

/** Whether the merged judgement goes straight to main, waits for the owner, or is dropped. */
export function decide(old: SourceEvaluation, merged: SourceEvaluation, verdict: Verdict, probe: ProbeSummary): Decision {
  if (!verdict.renders) return { action: "reject", reasons: ["the new build did not render, so there is nothing to judge"] };
  const reasons: string[] = [];
  if (merged.trustlessity.level > old.trustlessity.level) {
    reasons.push(`the level rose from ${old.trustlessity.level} to ${merged.trustlessity.level}`);
  }
  if (!old.trustlessity.privacy && merged.trustlessity.privacy) reasons.push("the judgement gained the privacy mark");
  if (verdict.injectionSuspected) reasons.push("the judge suspects the site tried to steer it");
  const thirdParty = probe.thirdParty.scripts.length + probe.thirdParty.frames.length;
  if ((merged.trustlessity.level === 3 || merged.trustlessity.level === 4) && thirdParty > 0) {
    reasons.push(`third-party code loads by itself (${thirdParty} script or frame request${thirdParty === 1 ? "" : "s"}), which caps a site at Level 2`);
  }
  return reasons.length > 0 ? { action: "hold", reasons } : { action: "apply", reasons: [] };
}
