import { createServer } from "node:http";
import type { Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const TYPES: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
};

export type Resolved = { ok: true; segments: string[] } | { ok: false; status: 400 | 404 };

/** Decodes a raw request target into path segments; anything that could leave the root is refused. */
export function resolveTarget(rawUrl: string): Resolved {
  if (!rawUrl.startsWith("/")) return { ok: false, status: 400 };
  const raw = rawUrl.split(/[?#]/, 1)[0] ?? "";
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return { ok: false, status: 400 };
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return { ok: false, status: 400 };
  const segments = decoded.split("/").filter((s) => s !== "" && s !== ".");
  for (const s of segments) {
    if (s === ".." || s.includes(":")) return { ok: false, status: 404 };
  }
  return { ok: true, segments };
}

function inside(root: string, file: string): boolean {
  const rel = path.relative(root, file);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function startServer(root: string, port: number, host: string): Promise<Server> {
  const base = path.resolve(root);
  const server = createServer((req, res) => {
    const send = (status: number, body: string, type = "text/plain; charset=utf-8", extra: Record<string, string> = {}) => {
      res.writeHead(status, {
        "Content-Type": type,
        "Content-Length": Buffer.byteLength(body),
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...extra,
      });
      res.end(req.method === "HEAD" ? undefined : body);
    };
    handle(req.method ?? "", req.url ?? "", base).then(
      (r) => send(r.status, r.body, r.type, r.headers),
      () => send(500, "internal error\n"),
    );
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

interface Answer {
  status: number;
  body: string;
  type?: string;
  headers?: Record<string, string>;
}

async function handle(method: string, url: string, base: string): Promise<Answer> {
  if (method !== "GET" && method !== "HEAD") return { status: 405, body: "method not allowed\n", headers: { Allow: "GET, HEAD" } };
  const target = resolveTarget(url);
  if (!target.ok) return { status: target.status, body: target.status === 400 ? "bad request\n" : "not found\n" };
  let file = path.join(base, ...target.segments);
  if (!inside(base, file)) return { status: 404, body: "not found\n" };
  try {
    const info = await stat(file);
    if (info.isDirectory()) {
      if (!url.split(/[?#]/, 1)[0]?.endsWith("/") && target.segments.length > 0) {
        const to = `/${target.segments.map(encodeURIComponent).join("/")}/`;
        return { status: 301, body: "", headers: { Location: to } };
      }
      file = path.join(file, "index.html");
    }
    const body = await readFile(file, "utf8");
    return { status: 200, body, type: TYPES[path.extname(file)] ?? "text/plain; charset=utf-8" };
  } catch {
    return { status: 404, body: "not found\n" };
  }
}
