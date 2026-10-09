import type { Env } from "../../../env.js";
import { samsaraFetch } from "./samsaraHttp.js";

/**
 * `GET /fleet/documents` — the documents drivers submit from Samsara's driver app (DOCUMENT-READER-PLAN
 * Step 0.1). Measured 2026-10-08 with this carrier's read-only token: 200, `data` is an ARRAY (so the
 * envelope `listAllPages` expects), `startTime`/`endTime` are required, and `queryBy=updated` is
 * accepted — which is the mode used here, because a driver can edit a submitted document and a
 * created-time window would never see the edit.
 *
 * ── WHY NOT `listAllPages` ───────────────────────────────────────────────────────────────────────
 * That helper sets `limit=512` and walks to the end with no bound. This endpoint answered a 100-limit
 * request with 32 rows, so it caps pages itself, and a cursor that never terminates on a scheduler is a
 * hang. The walk is bounded by `MAX_PAGES` and HITTING the bound throws rather than returning a
 * truncated window: the collector's watermark is derived from what it stored, so a silently partial
 * window would advance it past documents that were never written.
 *
 * Everything else — per-token pacing, 429/5xx retry with jitter, the request deadline — comes from
 * `samsaraFetch`, as it must for anything that shares the token's rate limit with the live tiers.
 */
export const DOCUMENTS_MAX_PAGES = 200;

export type SamsaraDocumentsFetcher = (window: { startIso: string; endIso: string }) => Promise<unknown[]>;

export function makeSamsaraDocumentsFetcher(env: Env, token: string): SamsaraDocumentsFetcher {
  return async ({ startIso, endIso }) => {
    const out: unknown[] = [];
    let after: string | undefined;
    let pages = 0;
    do {
      if (pages++ >= DOCUMENTS_MAX_PAGES) {
        throw new Error(
          `Samsara documents ${startIso}..${endIso}: more than ${DOCUMENTS_MAX_PAGES} pages — refusing a partial window`,
        );
      }
      const url = new URL("/fleet/documents", env.SAMSARA_API_URL);
      url.searchParams.set("startTime", startIso);
      url.searchParams.set("endTime", endIso);
      url.searchParams.set("queryBy", "updated");
      if (after) url.searchParams.set("after", after);
      const res = await samsaraFetch(env, token, url, { priority: "backfill" });
      if (!res.ok) throw new Error(`Samsara documents API ${res.status}`);
      const json = (await res.json()) as {
        data?: unknown[];
        pagination?: { endCursor?: string; hasNextPage?: boolean };
      };
      if (Array.isArray(json.data)) out.push(...json.data);
      after = json.pagination?.hasNextPage ? json.pagination.endCursor : undefined;
    } while (after);
    return out;
  };
}
