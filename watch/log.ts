/** One line per event on stdout, with a timestamp; systemd keeps it. */
export function log(message: string): void {
  process.stdout.write(`${new Date().toISOString()} ${message}\n`);
}

/** Site text and tool output are untrusted and may be long: only a short, single-line piece goes to the log. */
export function clip(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
