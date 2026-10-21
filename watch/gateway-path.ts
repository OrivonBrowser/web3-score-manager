import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

export interface GatewayResponse {
  status: number;
  /** An absolute path inside the site that holds the body. */
  file?: string;
  body?: string;
  headers: Record<string, string>;
}

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  wasm: "application/wasm",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml",
  webmanifest: "application/manifest+json",
  map: "application/json",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
};

export function contentType(file: string): string {
  const ext = path.extname(file).slice(1).toLowerCase();
  return TYPES[ext] ?? "application/octet-stream";
}

const HTML = { "Content-Type": TYPES.html! };
const TEXT = { "Content-Type": "text/plain; charset=utf-8" };

function inside(root: string, real: string): boolean {
  return real === root || real.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

/** The real path of `p` when it exists inside the site, "outside" when a symlink leads out, null when absent. */
function locate(root: string, p: string): string | "outside" | null {
  let real: string;
  try {
    real = realpathSync(p);
  } catch {
    return null;
  }
  return inside(root, real) ? real : "outside";
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function listing(dir: string, urlPath: string): string {
  const items = readdirSync(dir, { withFileTypes: true })
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
    .sort();
  const rows = items.map((n) => `<li><a href="${esc(encodeURI(n))}">${esc(n)}</a></li>`).join("");
  return `<!doctype html><title>Index of ${esc(urlPath)}</title><h1>Index of ${esc(urlPath)}</h1><ul>${rows}</ul>`;
}

interface Redirect {
  from: string;
  to: string;
  status: number;
}

function parseRedirects(text: string): Redirect[] {
  const rules: Redirect[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const [from, to, code] = line.split(/\s+/);
    if (!from || !to) continue;
    const status = code === undefined ? 301 : Number(code.replace(/!$/, ""));
    if (!Number.isInteger(status)) continue;
    rules.push({ from, to, status });
  }
  return rules;
}

function matchRule(rule: Redirect, requested: string): string | null {
  const pattern = rule.from.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "(.*)");
  const m = new RegExp(`^${pattern}$`).exec(requested);
  if (!m) return null;
  return rule.to.replaceAll(":splat", m[1] ?? "");
}

/**
 * What an IPFS gateway answers for a path in a site, as Kubo does for the parts a build relies on:
 * index files, directory listings, `_redirects` and `ipfs-404.html`. Nothing outside `siteDir` is
 * ever returned, whatever a symlink or a `..` says.
 */
export function resolveGatewayPath(siteDir: string, urlPath: string): GatewayResponse {
  const forbidden: GatewayResponse = { status: 403, body: "forbidden", headers: TEXT };
  let root: string;
  try {
    root = realpathSync(siteDir);
  } catch {
    return { status: 404, body: "404 page not found", headers: TEXT };
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split(/[?#]/, 1)[0] ?? "");
  } catch {
    return { status: 400, body: "bad request", headers: TEXT };
  }
  if (decoded.includes("\0")) return { status: 400, body: "bad request", headers: TEXT };
  const segments = decoded.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.includes("..")) return { status: 400, body: "bad request", headers: TEXT };
  const trailingSlash = decoded.endsWith("/") || segments.length === 0;
  const requested = `/${segments.join("/")}${trailingSlash && segments.length > 0 ? "/" : ""}`;

  const serve = (real: string, status = 200): GatewayResponse => ({ status, file: real, headers: { "Content-Type": contentType(real) } });

  const target = locate(root, path.join(root, ...segments));
  if (target === "outside") return forbidden;
  if (target !== null && isDir(target)) {
    const index = locate(root, path.join(target, "index.html"));
    if (index === "outside") return forbidden;
    if (index !== null && isFile(index)) return serve(index);
    return { status: 200, body: listing(target, requested), headers: HTML };
  }
  if (target !== null && isFile(target) && !trailingSlash) return serve(target);

  const redirects = locate(root, path.join(root, "_redirects"));
  if (redirects !== null && redirects !== "outside" && isFile(redirects)) {
    let rules: Redirect[] = [];
    try {
      rules = parseRedirects(readFileSync(redirects, "utf8").slice(0, 64 * 1024));
    } catch {
      rules = [];
    }
    for (const rule of rules) {
      const to = matchRule(rule, requested);
      if (to === null) continue;
      if (rule.status >= 300 && rule.status < 400) return { status: rule.status, headers: { Location: to, ...TEXT }, body: "" };
      if (rule.status === 200 || rule.status === 404) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(to)) continue;
        const dest = to.split(/[?#]/, 1)[0] ?? "";
        if (dest.split("/").includes("..")) continue;
        const real = locate(root, path.join(root, ...dest.split("/").filter((s) => s !== "")));
        if (real === null || real === "outside") continue;
        const file = isDir(real) ? locate(root, path.join(real, "index.html")) : real;
        if (file !== null && file !== "outside" && isFile(file)) return serve(file, rule.status);
      }
    }
  }

  let dir = trailingSlash ? segments : segments.slice(0, -1);
  for (;;) {
    const candidate = locate(root, path.join(root, ...dir, "ipfs-404.html"));
    if (candidate !== null && candidate !== "outside" && isFile(candidate)) return serve(candidate, 404);
    if (dir.length === 0) break;
    dir = dir.slice(0, -1);
  }
  return { status: 404, body: "404 page not found", headers: TEXT };
}
