import type { SourceEvaluation } from "../src/types.ts";
import type { Verdict } from "./verdict.ts";

export const MAX_MESSAGE = 4096;

export const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string): string => esc(s).replace(/"/g, "&quot;");

/** A piece of a message: plain text that is escaped when rendered, so it can be cut anywhere without breaking markup. */
interface Block {
  plain: string;
  wrap: (escaped: string) => string;
  /** Never cut. */
  fixed?: boolean;
}

const text = (plain: string, fixed = false): Block => ({ plain, wrap: (e) => e, fixed });
const bold = (plain: string): Block => ({ plain, wrap: (e) => `<b>${e}</b>`, fixed: true });

function render(blocks: Block[], separator = "\n"): string {
  const sizes = blocks.map((b) => b.plain.length);
  const cut = (b: Block, n: number): string => (n < b.plain.length ? `${b.plain.slice(0, Math.max(0, n - 1))}…` : b.plain);
  const build = (): string => blocks.map((b, i) => b.wrap(esc(cut(b, sizes[i]!)))).join(separator);
  let out = build();
  let guard = 10_000;
  while (out.length > MAX_MESSAGE && guard-- > 0) {
    let longest = -1;
    blocks.forEach((b, i) => {
      if (b.fixed || sizes[i]! <= 1) return;
      if (longest === -1 || sizes[i]! > sizes[longest]!) longest = i;
    });
    if (longest === -1) break;
    sizes[longest] = Math.max(1, sizes[longest]! - Math.max(8, out.length - MAX_MESSAGE));
    out = build();
  }
  return out.length > MAX_MESSAGE ? `${out.slice(0, MAX_MESSAGE - 1)}…` : out;
}

const BADGE = ["", "⚪", "🔵", "🟢", "🟣"];

function levelLine(e: { trustlessity: { level: number; privacy: boolean } }): Block {
  const { level, privacy } = e.trustlessity;
  return { plain: `Level ${level}`, wrap: (x) => `${BADGE[level] ?? ""} <b>${x}</b> · ${privacy ? "🛡 privacy" : "no privacy"}`, fixed: true };
}

export function shortCid(cid: string): string {
  const bare = cid.replace(/^cid:/, "");
  return bare.length > 16 ? `${bare.slice(0, 10)}…${bare.slice(-4)}` : bare;
}

function direction(before: number, after: number): string {
  return after > before ? "⬆️ raised" : after < before ? "⬇️ lowered" : "➡️ unchanged";
}

const quote = (plain: string): Block => ({ plain, wrap: (e) => `<blockquote expandable>${e}</blockquote>` });

function bullets(items: { name: string; trustlessity: { level: number } }[], prefix: string): Block[] {
  const shown = items.slice(0, 12);
  const out = shown.map((p) => text(`• ${p.name} · ${prefix}${p.trustlessity.level}`));
  if (items.length > shown.length) out.push(text(`• …and ${items.length - shown.length} more`, true));
  return out;
}

export interface JudgedMessage {
  name: string;
  cid: string;
  oldEval: SourceEvaluation;
  newEval: SourceEvaluation;
  verdict: Verdict;
  action: "apply" | "hold";
  reasons: string[];
  commitUrl?: string;
  compareUrl?: string;
  publishedCid?: string;
  model: string;
  costUsd?: number;
  turns?: number;
  dryRun?: boolean;
}

export function formatJudged(m: JudgedMessage): string {
  const first = m.name.split(", ")[0] ?? m.name;
  const blocks: Block[] = [
    { plain: `Attila re-judged ${m.name}`, wrap: (e) => `🛰 <b>${e}</b>`, fixed: true },
    { plain: shortCid(m.cid), wrap: (e) => `New build <code>${e}</code>`, fixed: true },
    text(""),
    { plain: `judged ${m.oldEval.evaluated}`, wrap: (e) => `<b>Before</b> · ${e}`, fixed: true },
    levelLine(m.oldEval),
    ...(m.oldEval.summary ? [quote(m.oldEval.summary)] : []),
    text(""),
    {
      plain: `${m.newEval.evaluated} · ${direction(m.oldEval.trustlessity.level, m.newEval.trustlessity.level)}`,
      wrap: (e) => `<b>Now</b> · ${e}`,
      fixed: true,
    },
    levelLine(m.newEval),
    ...(m.newEval.summary ? [quote(m.newEval.summary)] : []),
  ];
  if (m.verdict.changes !== "") blocks.push(text(""), bold("What changed"), text(m.verdict.changes));
  const connections = m.newEval.connections ?? [];
  if (connections.length > 0) blocks.push(text(""), bold("🔌 Connections"), ...bullets(connections, "L"));
  const operations = m.newEval.operations ?? [];
  if (operations.length > 0) blocks.push(text(""), bold("⚙️ Operations"), ...bullets(operations, "L"));
  if (m.verdict.concerns !== "") blocks.push(text(""), bold("⚠️ Concerns"), text(m.verdict.concerns));
  blocks.push(text(""));
  if (m.dryRun) blocks.push(text("🧪 Dry run: nothing was pushed or published.", true));
  if (m.action === "hold") {
    blocks.push(bold("⏸ Waiting for your review"), ...m.reasons.map((r) => text(`• ${r}`)));
    if (m.compareUrl) blocks.push({ plain: m.compareUrl.includes("/pull/") ? "Review the pull request" : "Open the pull request", wrap: (e) => `<a href="${escAttr(m.compareUrl!)}">${e}</a>`, fixed: true });
  } else {
    const live = m.publishedCid
      ? { plain: shortCid(m.publishedCid), wrap: (e: string) => `✅ Live in Orivon · Attila <code>${e}</code>`, fixed: true }
      : text(m.dryRun ? "✅ Would be applied." : "✅ Saved to main; publishing Attila is still to come.", true);
    blocks.push(live);
  }
  const links: string[] = [];
  if (m.action === "apply" && m.commitUrl) links.push(`<a href="${escAttr(m.commitUrl)}">Commit</a>`);
  links.push(`<a href="${escAttr(`https://${first}.limo/`)}">Site</a>`);
  blocks.push({ plain: "", wrap: () => `🔗 ${links.join(" · ")}`, fixed: true });
  const meta = [m.model, m.turns !== undefined ? `${m.turns} turns` : "", m.costUsd !== undefined ? `$${m.costUsd.toFixed(2)}` : ""].filter((s) => s !== "");
  blocks.push({ plain: meta.join(" · "), wrap: (e) => `<i>${e}</i>`, fixed: true });
  return render(blocks);
}

export interface FailureMessage {
  name: string;
  cid: string;
  reason: string;
  attempts: number;
  givingUp: boolean;
  dryRun?: boolean;
}

export function formatFailure(m: FailureMessage): string {
  const blocks: Block[] = [
    { plain: `Attila could not judge ${m.name}`, wrap: (e) => `⚠️ <b>${e}</b>`, fixed: true },
    { plain: shortCid(m.cid), wrap: (e) => `Build <code>${e}</code>`, fixed: true },
    text(m.reason),
    text(m.givingUp ? `Gave up after ${m.attempts} tries.` : "Will retry next run.", true),
  ];
  if (m.dryRun) blocks.push(text("Dry run: nothing was pushed or published.", true));
  return render(blocks);
}

export function formatRunError(message: string): string {
  return render([{ plain: "The Attila watch run crashed", wrap: (e) => `🛑 <b>${e}</b>`, fixed: true }, text(message)]);
}

export function formatPublishFailure(message: string): string {
  return render([
    { plain: "Attila was judged but not republished", wrap: (e) => `⚠️ <b>${e}</b>`, fixed: true },
    text(message),
    text("The judgements are saved; the next run publishes again.", true),
  ]);
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

export interface Telegram {
  send(message: string): Promise<boolean>;
}

/** Sends one message; the token appears in the request address only and in no log line. */
export function telegramSender(token: string, chatId: string, log: (line: string) => void, fetchFn: typeof fetch = fetch): Telegram {
  const post = async (body: Record<string, unknown>): Promise<number> => {
    const response = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    return response.status;
  };
  return {
    async send(message) {
      try {
        let status = await post({ chat_id: chatId, text: message, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
        if (status === 400) {
          status = await post({ chat_id: chatId, text: stripTags(message).slice(0, MAX_MESSAGE), link_preview_options: { is_disabled: true } });
        }
        if (status >= 200 && status < 300) return true;
        log(`telegram answered ${status}`);
      } catch (e) {
        log(`telegram could not be reached: ${(e as Error).name}`);
      }
      return false;
    },
  };
}
