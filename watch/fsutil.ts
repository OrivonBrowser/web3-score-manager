import { closeSync, constants, fstatSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Reads a regular file without following a symlink at the last component; null when it is anything else or too big. */
export function readRegularFile(file: string, maxBytes: number): Buffer | null {
  let fd: number;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > maxBytes) return null;
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Writes next to the target, then renames, so a reader never sees half a file. */
export function writeFileAtomic(file: string, data: string | Uint8Array): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}
