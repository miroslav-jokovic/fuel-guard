import type { Env } from "../../../env.js";
import { samsaraFetch } from "./samsaraHttp.js";

/**
 * One Samsara GET, every page of it, as the BYTES Samsara sent — for evidence that must be hashed as
 * received (INSPECTION-CHALLENGE-PLAN D-IC4: the roadside inspection's frozen GPS window, assignments,
 * HOS logs and DVIRs). Every other fetcher here parses as it pages; a frozen answer must not, because
 * a hash over a re-serialised object proves only what our code made of it.
 *
 * Paced on the BACKFILL lane: a three-year evidence backfill must never starve the live feeds. A
 * non-2xx page ends the walk and is kept, status and body — "Samsara refused" is an answer too.
 */
export interface SamsaraRawAnswer {
  /** The last page's status: 200 for a full walk, the refusal otherwise. */
  status: number;
  /** Every page's body, in order. */
  pages: string[];
  /** False when the page cap stopped the walk before Samsara said there was no more. */
  complete: boolean;
}

/** 20 pages of 512 is far past any one inspection's answer (a fleet-day of DVIRs is one page of 143). */
const MAX_PAGES = 20;

export type SamsaraRawFetcher = (path: string, params: Record<string, string>) => Promise<SamsaraRawAnswer>;

export function makeSamsaraRawFetcher(env: Env, token: string): SamsaraRawFetcher {
  return async (path, params) => {
    const pages: string[] = [];
    let after: string | undefined;
    do {
      const url = new URL(path, env.SAMSARA_API_URL);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      if (after) url.searchParams.set("after", after);
      const res = await samsaraFetch(env, token, url, { priority: "backfill" });
      const body = await res.text();
      pages.push(body);
      if (!res.ok) return { status: res.status, pages, complete: false };
      after = nextCursor(body);
    } while (after && pages.length < MAX_PAGES);
    return { status: 200, pages, complete: after === undefined };
  };
}

function nextCursor(body: string): string | undefined {
  try {
    const p = (JSON.parse(body) as { pagination?: { hasNextPage?: boolean; endCursor?: string } }).pagination;
    return p?.hasNextPage && p.endCursor ? p.endCursor : undefined;
  } catch {
    return undefined;
  }
}
