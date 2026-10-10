import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { compileProvider, ValidationFailure, writeSite } from "./build.ts";
import { addEvaluation, initProvider, listEvaluations, newEvaluation, readBundleHash, removeEvaluation } from "./manage.ts";
import { DEFAULT_RESOLVER, checkNames, gatewayResolver, report } from "./moved.ts";
import { startServer } from "./serve.ts";
import { loadProvider } from "./source.ts";
import { UserError, formatIssue } from "./types.ts";

export interface Output {
  out(text: string): void;
  err(text: string): void;
}

type Options = NonNullable<Parameters<typeof parseArgs>[0]>["options"];

interface Command {
  usage: string;
  summary: string;
  options: Options;
  run(values: Record<string, string | boolean | (string | boolean)[] | undefined>, positionals: string[], io: Output): Promise<number>;
}

const DIR = { type: "string", default: "provider" } as const;
const HELP = { type: "boolean", short: "h" } as const;

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

const COMMANDS: Record<string, Command> = {
  init: {
    usage: 'init [--dir d] --name "<name>" [--bucket-hex-chars 2] [--about <url>]',
    summary: "create provider.json and the scores directory",
    options: { dir: DIR, name: { type: "string" }, "bucket-hex-chars": { type: "string", default: "2" }, about: { type: "string" } },
    async run(v, _p, io) {
      const name = str(v.name);
      if (!name) throw new UserError("--name is required");
      const file = initProvider(str(v.dir)!, { name, bucketHexChars: Number(v["bucket-hex-chars"]), about: str(v.about) });
      io.out(`created ${file}\n`);
      return 0;
    },
  },
  new: {
    usage: "new <website|operation|connection> <slug> [--dir d] [--id <identifier>]...",
    summary: "write a template evaluation to fill in",
    options: { dir: DIR, id: { type: "string", multiple: true } },
    async run(v, p, io) {
      if (p.length !== 2) throw new UserError("new takes a subject and a slug");
      const file = newEvaluation(str(v.dir)!, p[0]!, p[1]!, (v.id as string[] | undefined) ?? []);
      io.out(`created ${file}\nEdit it, then run: web3-score check\n`);
      return 0;
    },
  },
  add: {
    usage: "add <file.json> [--dir d] [--slug s] [--force]",
    summary: "validate an evaluation file and copy it into scores/",
    options: { dir: DIR, slug: { type: "string" }, force: { type: "boolean" } },
    async run(v, p, io) {
      if (p.length !== 1) throw new UserError("add takes one file");
      io.out(`added ${addEvaluation(str(v.dir)!, p[0]!, { slug: str(v.slug), force: v.force === true })}\n`);
      return 0;
    },
  },
  remove: {
    usage: "remove <slug-or-identifier> [--dir d]",
    summary: "delete one evaluation",
    options: { dir: DIR },
    async run(v, p, io) {
      if (p.length !== 1) throw new UserError("remove takes a slug or an identifier");
      io.out(`removed ${removeEvaluation(str(v.dir)!, p[0]!)}\n`);
      return 0;
    },
  },
  list: {
    usage: "list [--dir d]",
    summary: "one line per evaluation",
    options: { dir: DIR },
    async run(v, _p, io) {
      const { lines, issues } = listEvaluations(str(v.dir)!);
      if (lines.length > 0) io.out(`${lines.join("\n")}\n`);
      if (issues.length > 0) {
        io.err(`${issues.join("\n")}\n`);
        return 1;
      }
      return 0;
    },
  },
  check: {
    usage: "check [--dir d]",
    summary: "validate the provider and every evaluation",
    options: { dir: DIR },
    async run(v, _p, io) {
      const loaded = loadProvider(str(v.dir)!);
      if (loaded.issues.length > 0) {
        io.err(`${loaded.issues.map(formatIssue).join("\n")}\n`);
        return 1;
      }
      io.out(`${loaded.evaluations.length} evaluations, valid\n`);
      return 0;
    },
  },
  moved: {
    usage: "moved [--dir d] [--resolver https://{name}.limo/]",
    summary: "list the watched .eth names that now serve a build no evaluation judges",
    options: { dir: DIR, resolver: { type: "string", default: DEFAULT_RESOLVER } },
    async run(v, _p, io) {
      const resolver = str(v.resolver)!;
      if (!resolver.includes("{name}")) throw new UserError("--resolver must contain {name}");
      const loaded = loadProvider(str(v.dir)!);
      if (loaded.issues.length > 0) throw new ValidationFailure(loaded.issues);
      const { text, failed } = report(await checkNames(loaded.evaluations, gatewayResolver(resolver)));
      io.out(text);
      return failed ? 1 : 0;
    },
  },
  ids: {
    usage: "ids <static-dir>",
    summary: "print the Orivon bundle hash of a built static app",
    options: {},
    async run(_v, p, io) {
      if (p.length !== 1) throw new UserError("ids takes one directory");
      io.out(`${readBundleHash(p[0]!)}\n`);
      return 0;
    },
  },
  build: {
    usage: "build [--dir d] [--out dist]",
    summary: "validate, then write the static site",
    options: { dir: DIR, out: { type: "string", default: "dist" } },
    async run(v, _p, io) {
      const dir = str(v.dir)!;
      const files = compileProvider(dir);
      writeSite(str(v.out)!, files, dir);
      io.out(`built ${files.size} files into ${str(v.out)}\nProvider address after upload: <your address>/score\n`);
      return 0;
    },
  },
  serve: {
    usage: "serve [--dir d] [--port 7860] [--host 127.0.0.1]",
    summary: "build into a temporary directory and serve it",
    options: { dir: DIR, port: { type: "string", default: "7860" }, host: { type: "string", default: "127.0.0.1" } },
    async run(v, _p, io) {
      const port = Number(v.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UserError("--port must be 0 to 65535");
      const files = compileProvider(str(v.dir)!);
      const root = mkdtempSync(path.join(tmpdir(), "web3-score-"));
      writeSite(root, files);
      const server = await startServer(root, port, str(v.host)!);
      const addr = server.address();
      const shown = typeof addr === "object" && addr ? addr.port : port;
      io.out(`Provider address: http://${str(v.host)}:${shown}/score\nCtrl+C to stop\n`);
      await new Promise<void>((resolve) => {
        const stop = () => {
          server.close(() => resolve());
          server.closeAllConnections();
        };
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
      });
      rmSync(root, { recursive: true, force: true });
      return 0;
    },
  },
};

export function usage(): string {
  const rows = Object.values(COMMANDS).map((c) => `  web3-score ${c.usage}\n      ${c.summary}`);
  return `Usage:\n${rows.join("\n")}\n\nEvery command takes --help. --dir defaults to ./provider.\n`;
}

export async function main(argv: string[], io: Output): Promise<number> {
  const [name, ...rest] = argv;
  if (name === undefined || name === "--help" || name === "-h" || name === "help") {
    (name === undefined ? io.err : io.out)(usage());
    return name === undefined ? 2 : 0;
  }
  const command = COMMANDS[name];
  if (!command) {
    io.err(`unknown command "${name}"\n${usage()}`);
    return 2;
  }
  let parsed;
  try {
    parsed = parseArgs({ args: rest, options: { ...command.options, help: HELP }, allowPositionals: true, strict: true });
  } catch (e) {
    io.err(`${(e as Error).message}\nweb3-score ${command.usage}\n`);
    return 2;
  }
  if (parsed.values.help) {
    io.out(`web3-score ${command.usage}\n  ${command.summary}\n`);
    return 0;
  }
  try {
    return await command.run(parsed.values, parsed.positionals, io);
  } catch (e) {
    if (e instanceof ValidationFailure) {
      io.err(`${e.issues.map(formatIssue).join("\n")}\n`);
      return 1;
    }
    if (e instanceof UserError) {
      io.err(`error: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
}
