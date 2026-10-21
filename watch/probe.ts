// Opens a build in headless Chromium inside the sandbox, with no network at all. This is the only
// module that imports playwright, so the tests never load it.
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveGatewayPath } from "./gateway-path.ts";

interface PwRequest {
  url(): string;
  method(): string;
  resourceType(): string;
  frame(): { parentFrame(): unknown };
}
interface PwRoute {
  request(): PwRequest;
  fulfill(options: { status: number; headers: Record<string, string>; path?: string; body?: string }): Promise<void>;
  abort(errorCode?: string): Promise<void>;
}
interface PwWebSocketRoute {
  url(): string;
  close(): Promise<void> | void;
}
interface PwPage {
  on(event: string, handler: (arg: never) => void): void;
  goto(url: string, options: { waitUntil: string; timeout: number }): Promise<{ status(): number } | null>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<T>(fn: () => T): Promise<T>;
  screenshot(options: { path: string; timeout: number }): Promise<unknown>;
}
interface PwContext {
  route(url: string, handler: (route: PwRoute) => Promise<void> | void): Promise<void>;
  routeWebSocket(url: RegExp, handler: (ws: PwWebSocketRoute) => void): Promise<void>;
  newPage(): Promise<PwPage>;
}
interface PwBrowser {
  newContext(options: Record<string, unknown>): Promise<PwContext>;
  close(): Promise<void>;
}
interface Playwright {
  chromium: { launch(options: { headless: boolean; args: string[] }): Promise<PwBrowser> };
}

const MAX_REQUESTS = 2000;
const OBSERVE_MS = 20_000;

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--mute-audio",
  "--autoplay-policy=user-gesture-required",
  "--proxy-server=http://127.0.0.1:9",
  "--proxy-bypass-list=<-loopback>",
  "--disable-features=DnsOverHttps",
];

type Outcome = "served" | "missing" | "blocked" | "unknown";

interface RequestRecord {
  url: string;
  type: string;
  method: string;
  ms: number;
  outcome: Outcome;
}

interface PageFacts {
  title: string;
  textLength: number;
  textSample: string;
  scripts: { src: string; integrity: boolean }[];
  inlineScripts: number;
  iframes: string[];
  stylesheets: string[];
  visibleMedia: boolean;
}

function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.origin === "null" ? null : u.origin;
  } catch {
    return null;
  }
}

/** Runs in the page: only what is needed to tell whether anything rendered and what it loads. */
function collectPageFacts(): PageFacts {
  const text = document.body ? document.body.innerText : "";
  const visible = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 50 && r.height > 50 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) !== 0;
  };
  const media = Array.from(document.querySelectorAll("img,canvas,svg,video"));
  const scripts = Array.from(document.scripts);
  return {
    title: document.title,
    textLength: text.length,
    textSample: text.slice(0, 1500),
    scripts: scripts.filter((s) => s.src).map((s) => ({ src: s.src, integrity: s.hasAttribute("integrity") })),
    inlineScripts: scripts.filter((s) => !s.src).length,
    iframes: Array.from(document.querySelectorAll("iframe")).map((f) => f.src),
    stylesheets: Array.from(document.querySelectorAll('link[rel~="stylesheet"]')).map((l) => (l as HTMLLinkElement).href),
    visibleMedia: media.some(visible),
  };
}

async function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function probe(siteDir: string, outDir: string, cid: string): Promise<void> {
  if (!/^[a-z0-9]{10,100}$/.test(cid)) throw new Error("the CID is not a plain lowercase string");
  const site = realpathSync(siteDir);
  mkdirSync(outDir, { recursive: true });
  const moduleName = "playwright";
  const { chromium } = (await import(moduleName)) as Playwright;
  const origin = `http://${cid}.ipfs.localhost:8080`;
  const started = Date.now();
  const requests: RequestRecord[] = [];
  const byRequest = new Map<PwRequest, RequestRecord>();
  const websockets: { url: string; ms: number }[] = [];
  const framed = new Set<RequestRecord>();
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  let dropped = 0;

  const recordFor = (request: PwRequest): RequestRecord | null => {
    const known = byRequest.get(request);
    if (known) return known;
    const url = request.url();
    if (url.startsWith("data:") || url.startsWith("blob:")) return null;
    if (requests.length >= MAX_REQUESTS) {
      dropped++;
      return null;
    }
    const entry: RequestRecord = {
      url: url.slice(0, 300),
      type: request.resourceType(),
      method: request.method(),
      ms: Date.now() - started,
      outcome: "unknown",
    };
    requests.push(entry);
    byRequest.set(request, entry);
    if (request.resourceType() === "document" && request.frame().parentFrame() !== null) framed.add(entry);
    return entry;
  };

  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  let status: number | null = null;
  let page: PwPage | undefined;
  let facts: PageFacts | undefined;
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block", locale: "en-US" });
    await context.route("**/*", async (route) => {
      const request = route.request();
      const entry = recordFor(request);
      if (originOf(request.url()) !== origin) {
        if (entry) entry.outcome = "blocked";
        await route.abort("blockedbyclient");
        return;
      }
      const answer = resolveGatewayPath(site, new URL(request.url()).pathname);
      if (entry) entry.outcome = answer.status === 404 || answer.status === 400 || answer.status === 403 ? "missing" : "served";
      if (answer.file !== undefined) await route.fulfill({ status: answer.status, headers: answer.headers, path: answer.file });
      else await route.fulfill({ status: answer.status, headers: answer.headers, body: answer.body ?? "" });
    });
    await context.routeWebSocket(/.*/, (ws) => {
      if (websockets.length < 200) websockets.push({ url: ws.url().slice(0, 300), ms: Date.now() - started });
      void ws.close();
    });
    page = await context.newPage();
    page.on("request", (request: PwRequest) => void recordFor(request));
    page.on("pageerror", (error: Error) => {
      if (pageErrors.length < 20) pageErrors.push(String(error.message ?? error).slice(0, 200));
    });
    page.on("console", (message: { type(): string; text(): string }) => {
      if (message.type() === "error" && consoleErrors.length < 20) consoleErrors.push(message.text().slice(0, 200));
    });

    try {
      const response = await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      status = response ? response.status() : null;
    } catch (e) {
      pageErrors.push(`navigation failed: ${String((e as Error).message).slice(0, 150)}`);
    }
    await page.waitForTimeout(Math.max(0, OBSERVE_MS - (Date.now() - started)));

    facts = await withTimeout(page.evaluate(collectPageFacts).catch(() => undefined), 10_000, undefined);
    try {
      await page.screenshot({ path: path.join(outDir, "screenshot.png"), timeout: 15_000 });
    } catch (e) {
      pageErrors.push(`screenshot failed: ${String((e as Error).message).slice(0, 150)}`);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const foreign = (url: string): boolean => {
    const o = originOf(url);
    return o !== null && o !== origin;
  };
  const origins = new Set<string>();
  for (const r of requests) {
    const o = originOf(r.url);
    if (o !== null && o !== origin) origins.add(o);
  }
  for (const w of websockets) {
    try {
      const u = new URL(w.url);
      origins.add(`${u.protocol}//${u.host}`);
    } catch {
      // an unparsable address stays in the websockets list for the judge to read
    }
  }
  const scriptsOut = requests.filter((r) => r.type === "script" && foreign(r.url)).map((r) => r.url);
  const framesOut = requests.filter((r) => framed.has(r) && foreign(r.url)).map((r) => r.url);
  const renders = facts !== undefined && (facts.textLength > 0 || facts.visibleMedia);

  const result = {
    url: `${origin}/`,
    status,
    title: facts?.title.slice(0, 200) ?? "",
    renders,
    textSample: facts?.textSample ?? "",
    requests,
    requestsDropped: dropped,
    websockets,
    thirdParty: { origins: [...origins].sort(), scripts: scriptsOut, frames: framesOut },
    scripts: facts?.scripts ?? [],
    inlineScripts: facts?.inlineScripts ?? 0,
    iframes: facts?.iframes ?? [],
    stylesheets: facts?.stylesheets ?? [],
    pageErrors,
    consoleErrors,
  };
  writeFileSync(path.join(outDir, "probe.json"), `${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [siteDir, outDir, cid] = process.argv.slice(2);
  if (!siteDir || !outDir || !cid) {
    process.stderr.write("usage: node probe.ts <siteDir> <outDir> <cid>\n");
    process.exit(2);
  }
  probe(siteDir, outDir, cid).then(
    () => process.exit(0),
    (e: unknown) => {
      process.stderr.write(`probe failed: ${String((e as Error).message ?? e)}\n`);
      process.exit(1);
    },
  );
}
