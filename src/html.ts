import { SCALE_MAX, levelLabel, privacyLabel } from "./labels.ts";
import type { LoadedEvaluation } from "./source.ts";
import { SUBJECTS } from "./types.ts";
import type { Part, ProviderDescriptor, Subject, Trustlessity } from "./types.ts";

export function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CSS = `
:root{color-scheme:light dark;--bg:#fafafa;--fg:#1a1a1a;--muted:#5c5c66;--card:#fff;--line:#dcdce2;--accent:#1f5fbf;--chip:#eef1f7}
@media (prefers-color-scheme:dark){:root{--bg:#121216;--fg:#e8e8ee;--muted:#9a9aa8;--card:#1b1b22;--line:#33333d;--accent:#7fb0ff;--chip:#262631}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:52rem;margin:0 auto;padding:1.5rem 1rem 3rem}
h1{font-size:1.6rem;margin:0 0 .25rem}
h2{font-size:1.2rem;margin:2rem 0 .75rem}
h3{font-size:1.1rem;margin:0}
a{color:var(--accent)}
.hint,.meta,.note{color:var(--muted)}
.note{display:block}
.hint{margin:.25rem 0 0}
article{background:var(--card);border:1px solid var(--line);border-radius:.6rem;padding:1rem;margin:0 0 1rem}
.meta{font-size:.9rem;margin:.15rem 0 .6rem}
.ids{list-style:none;margin:.4rem 0;padding:0}
code,.ids li{font:.85rem/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow-wrap:anywhere;word-break:break-all}
.level{display:inline-block;background:var(--chip);border-radius:.4rem;padding:.1rem .5rem;font-weight:600}
.privacy{display:inline-block;border:1px solid var(--accent);color:var(--accent);border-radius:.4rem;padding:0 .4rem;font-size:.85rem;margin-left:.4rem}
table{width:100%;border-collapse:collapse;margin:.5rem 0 1rem;font-size:.92rem}
th,td{text-align:left;vertical-align:top;border-top:1px solid var(--line);padding:.4rem .5rem .4rem 0}
th{color:var(--muted);font-weight:600;border-top:0}
caption{text-align:left;font-weight:600;padding:.25rem 0}
ul.evidence{margin:.4rem 0 0;padding-left:1.2rem;overflow-wrap:anywhere}
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

function level(subject: Subject, t: Trustlessity): string {
  const label = levelLabel(subject, t.level);
  const priv = t.privacy ? `<span class="privacy" title="${esc(privacyLabel(subject))}">+ privacy</span>` : "";
  return `<span class="level">Level ${t.level} of ${SCALE_MAX[subject]}</span>${priv}<span class="note">${esc(label)}${
    t.privacy ? `; privacy: ${esc(privacyLabel(subject))}` : ""
  }</span>`;
}

function partsTable(caption: string, subject: Subject, list: Part[]): string {
  const rows = list
    .map((p) => {
      const note = p.note ? esc(p.note) : "";
      const id = p.id ? `<div><code>${esc(p.id)}</code></div>` : "";
      return `<tr><td>${esc(p.name)}${id}</td><td>${level(subject, p.trustlessity)}</td><td>${note}</td></tr>`;
    })
    .join("\n");
  return `<table>
<caption>${esc(caption)}</caption>
<thead><tr><th>Name</th><th>Level</th><th>Note</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`;
}

function evidenceItem(url: string): string {
  const web = /^https?:/.test(url);
  return `<li>${web ? `<a href="${esc(url)}" rel="noopener noreferrer">${esc(url)}</a>` : `<code>${esc(url)}</code>`}</li>`;
}

function article(item: LoadedEvaluation): string {
  const e = item.evaluation;
  const meta = [e.version ? `version ${esc(e.version)}` : "", `evaluated ${esc(e.evaluated)}`].filter(Boolean).join(" &middot; ");
  const ids = e.ids.map((id) => `<li>${esc(id)}</li>`).join("\n");
  return `<article id="${esc(item.subject)}-${esc(item.slug)}">
<h3>${esc(e.name)}</h3>
<p class="meta">${meta}</p>
<p>${level(item.subject, e.trustlessity)}</p>
${e.summary ? `<p>${esc(e.summary)}</p>` : ""}
<ul class="ids">
${ids}
</ul>
${e.operations?.length ? partsTable("Operations", "operation", e.operations) : ""}
${e.connections?.length ? partsTable("Connections", "connection", e.connections) : ""}
${e.evidence?.length ? `<p class="meta">Evidence</p>\n<ul class="evidence">\n${e.evidence.map(evidenceItem).join("\n")}\n</ul>` : ""}
</article>`;
}

function about(provider: ProviderDescriptor): string {
  if (!provider.about) return "";
  const web = /^https?:\/\//.test(provider.about);
  const text = esc(provider.about);
  return `<p class="hint">About this provider: ${web ? `<a href="${text}" rel="noopener noreferrer">${text}</a>` : `<code>${text}</code>`}</p>`;
}

export function renderIndex(provider: ProviderDescriptor, evaluations: LoadedEvaluation[]): string {
  const sections = SUBJECTS.map((subject) => {
    const list = evaluations.filter((x) => x.subject === subject);
    if (list.length === 0) return "";
    return `<h2>${subject === "website" ? "Websites" : subject === "operation" ? "Operations" : "Connections"}</h2>\n${list.map(article).join("\n")}`;
  }).join("\n");
  const body = `<h1>${esc(provider.name)}</h1>
<p class="hint">Web3 Score provider (${esc(provider.standard)}). Use this site's address followed by <code>/score</code> as the Web3 Score provider in Orivon's Settings &gt; Web3.</p>
${about(provider)}
<p class="hint"><a href="score/provider.json">score/provider.json</a></p>
${sections || '<p class="hint">No evaluations yet.</p>'}`;
  return page(provider.name, body);
}

export function renderScoreIndex(provider: ProviderDescriptor): string {
  return page(
    provider.name,
    `<h1>${esc(provider.name)}</h1>
<p class="hint">This address is a Web3 Score provider (${esc(provider.standard)}). Orivon reads <a href="provider.json">provider.json</a> and the bucket files beside it.</p>
<p><a href="../index.html">Read the evaluations</a></p>`,
  );
}
