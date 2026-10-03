import { createHash } from "node:crypto";

/** First `hexChars` characters of the hex SHA-256 of the full identifier, prefix included. */
export function bucketOf(id: string, hexChars: number): string {
  return createHash("sha256").update(id, "utf8").digest("hex").slice(0, hexChars);
}
