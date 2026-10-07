import type { Env } from "../../../env.js";
import { samsaraFetch } from "./samsaraHttp.js";
import {
  iftaMonthNumber,
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

/**
 * Samsara refused a month because it is still processing it — a period that is not available YET.
 *
 * ── WHY THIS IS ITS OWN ERROR (incident 2026-10-01) ─────────────────────────────────────────────
 * For about 72 hours after a month ends Samsara answers it with HTTP 400 and, measured 2026-10-07,
 *
 *     {"message":"IFTA data may still be processing. Please request data prior to 2026-10-01"}
 *
 * The daily sync asks for the last three COMPLETED months, so on the 1st–3rd of every month the
 * newest one is refused. Read as a plain failure, that failed every run for three days each month
 * (180 runs for August, 68 for September), turned the IFTA feed to `failing` and left the two settled
 * months behind it unrefreshed — for a period nobody could have fetched anyway.
 *
 * It is recognised from Samsara's OWN answer, not from our clock: the message names the first date it
 * will not serve, and only a requested month starting on or after that date is "not ready". A 400 for
 * a month BEFORE that date contradicts the message and stays an ordinary failure, as does any other
 * status or wording — a real outage must never be classified away.
 */
export class IftaPeriodNotReadyError extends Error {
  constructor(
    readonly year: number,
    readonly month: string,
    /** First day Samsara will not yet serve, `YYYY-MM-DD`, exactly as Samsara stated it. */
    readonly availableBefore: string,
  ) {
    super(`Samsara is still processing ${month} ${year} (it serves data before ${availableBefore})`);
    this.name = "IftaPeriodNotReadyError";
  }
}

const STILL_PROCESSING = /IFTA data may still be processing\. Please request data prior to (\d{4}-\d{2}-\d{2})/;

/**
 * The error for a refused month. Exported for its test. `body` is the raw response text; the
 * message Samsara put in it is carried onto a generic failure too (bounded), so an unexpected 400
 * says WHY instead of only a status.
 */
export function iftaRequestError(status: number, body: string, year: number, month: string): Error {
  let message: string | null = null;
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === "string") message = parsed.message;
  } catch {
    /* not JSON — a gateway page or an empty body; the status alone is reported */
  }
  const monthNumber = iftaMonthNumber(month);
  const stated = message ? STILL_PROCESSING.exec(message)?.[1] : undefined;
  if (status === 400 && stated && monthNumber != null) {
    const requestedStart = `${year}-${String(monthNumber).padStart(2, "0")}-01`;
    if (requestedStart >= stated) return new IftaPeriodNotReadyError(year, month, stated);
  }
  const detail = message ? `: ${message.slice(0, 200)}` : "";
  return new Error(`Samsara IFTA API ${status} for ${month} ${year}${detail}`);
}

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
      if (!res.ok) throw iftaRequestError(res.status, await res.text().catch(() => ""), year, month);
      const json = (await res.json()) as RawIftaResponse & {
        pagination?: { endCursor?: string; hasNextPage?: boolean };
      };
      pages.push(parseIftaVehicleReport(json));
      after = json.pagination?.hasNextPage ? json.pagination.endCursor : undefined;
    } while (after);

    return mergeIftaPages(pages);
  };
}
