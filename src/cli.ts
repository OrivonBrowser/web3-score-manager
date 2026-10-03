#!/usr/bin/env node
import { main } from "./commands.ts";

process.exitCode = await main(process.argv.slice(2), {
  out: (t) => void process.stdout.write(t),
  err: (t) => void process.stderr.write(t),
});
