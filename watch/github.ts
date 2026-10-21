import type { Config } from "./config.ts";

/**
 * Opens a pull request from a pushed branch into main, or finds the one already open for it, and
 * returns its address. Without a token, or when GitHub refuses, it returns undefined and the
 * caller links the branch comparison instead.
 */
export async function openPullRequest(config: Config, branch: string, title: string, body: string): Promise<string | undefined> {
  if (config.githubToken === undefined) return undefined;
  const api = `https://api.github.com/repos/${config.githubRepo}/pulls`;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${config.githubToken}`,
    "Content-Type": "application/json",
    "User-Agent": "attila-watch",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  try {
    const created = await fetch(api, {
      method: "POST",
      headers,
      body: JSON.stringify({ title, body, head: branch, base: "main" }),
      signal: AbortSignal.timeout(30_000),
    });
    if (created.ok) return ((await created.json()) as { html_url?: string }).html_url;
    const owner = config.githubRepo.split("/")[0];
    const open = await fetch(`${api}?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`, { headers, signal: AbortSignal.timeout(30_000) });
    if (!open.ok) return undefined;
    const list = (await open.json()) as { html_url?: string }[];
    return list[0]?.html_url;
  } catch {
    return undefined;
  }
}
