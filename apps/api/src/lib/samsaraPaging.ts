import type { Env } from "../env.js";
import { samsaraFetch } from "./samsaraHttp.js";

/** Follows the `after` cursor through every page of a Samsara list endpoint, merging `data`. */
export async function listAllPages(
  env: Env,
  token: string,
  path: string,
  extraParams: Record<string, string> = {},
): Promise<unknown[]> {
  const out: unknown[] = [];
  let after: string | undefined;
  do {
    const url = new URL(path, env.SAMSARA_API_URL);
    url.searchParams.set("limit", "512");
    for (const [k, v] of Object.entries(extraParams)) url.searchParams.set(k, v);
    if (after) url.searchParams.set("after", after);
    const res = await samsaraFetch(env, token, url);
    if (!res.ok) throw new Error(`Samsara API ${res.status}`);
    const json = (await res.json()) as {
      data?: unknown[];
      pagination?: { endCursor?: string; hasNextPage?: boolean };
    };
    if (Array.isArray(json.data)) out.push(...json.data);
    after = json.pagination?.hasNextPage ? json.pagination.endCursor : undefined;
  } while (after);
  return out;
}
