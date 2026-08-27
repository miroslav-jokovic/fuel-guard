import type { Env } from "../env.js";
import { samsaraFetch } from "./samsaraHttp.js";
import {
  mergeIftaPages,
  parseIftaVehicleReport,
  type IftaVehicleReport,
  type RawIftaResponse,
} from "@silvicom/shared";

/**
 * `GET /fleet/reports/ifta/vehicle` — per-vehicle, per-jurisdiction miles for one month.
 *
 * ── WHY THIS DOES NOT USE `listAllPages` ─────────────────────────────────────────────────────────
 * That helper merges `json.data` as an ARRAY, which every other Samsara list endpoint returns. This
 * one returns `data` as an OBJECT — `{ vehicleReports: [...], troubleshooting: {...}, year, month }` —
 * so `listAllPages` would push the object itself into its output and produce one useless element per
 * page. The cursor contract (`pagination.endCursor` / `hasNextPage`) is identical; only the envelope
 * differs, so the paging is repeated here rather than the shared helper being bent to two shapes.
 *
 * Everything else still comes from `samsaraFetch`: per-token pacing, 429/5xx retry with jitter, and
 * the request deadline. A fetcher that called `fetch` directly would bypass all three and could, on
 * its own, exhaust the token's rate limit for every other sync running beside it.
 *
 * ── THE PAGE GUARD ───────────────────────────────────────────────────────────────────────────────
 * A cursor that never terminates is a hang, and this runs on a scheduler. Measured on this carrier a
 * month comes back in ONE page (172 vehicles, `hasNextPage: false`), so 50 is far past any real fleet
 * and still bounded. Hitting it throws rather than returning a truncated month, because a partial
 * month written as though it were whole is a wrong tax figure that looks complete.
 */
const MAX_PAGES = 50;

export type SamsaraIftaFetcher = (year: number, month: string) => Promise<IftaVehicleReport>;

export function makeSamsaraIftaFetcher(env: Env, token: string): SamsaraIftaFetcher {
  return async (year, month) => {
    const pages: IftaVehicleReport[] = [];
    let after: string | undefined;
    let guard = 0;
    do {
      if (guard++ >= MAX_PAGES) {
        throw new Error(`Samsara IFTA ${month} ${year}: more than ${MAX_PAGES} pages — refusing a partial month`);
      }
      const url = new URL("/fleet/reports/ifta/vehicle", env.SAMSARA_API_URL);
      url.searchParams.set("year", String(year));
      url.searchParams.set("month", month);
      if (after) url.searchParams.set("after", after);

      const res = await samsaraFetch(env, token, url);
      if (!res.ok) throw new Error(`Samsara IFTA API ${res.status} for ${month} ${year}`);
      const json = (await res.json()) as RawIftaResponse & {
        pagination?: { endCursor?: string; hasNextPage?: boolean };
      };
      pages.push(parseIftaVehicleReport(json));
      after = json.pagination?.hasNextPage ? json.pagination.endCursor : undefined;
    } while (after);

    return mergeIftaPages(pages);
  };
}
