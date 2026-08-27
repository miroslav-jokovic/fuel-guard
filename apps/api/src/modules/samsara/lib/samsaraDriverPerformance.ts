import type { Env } from "../../../env.js";
import { samsaraFetch } from "./samsaraHttp.js";
import { listAllPages } from "./samsaraPaging.js";

// ── Driver performance: Safety Scores + Driver Efficiency (docs/16-DRIVER-PERFORMANCE.md) ────
const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/** Driver Safety Scores over a window (GET /safety-scores/drivers) — driverIds batched ≤100, cursor-paginated.
 *  Scope: Read Safety Events & Scores. Returns the merged `data` across batches + pages. */
export type SamsaraSafetyScoreFetcher = (
  startIso: string,
  endIso: string,
  driverIds?: string[],
) => Promise<{ data: unknown[] }>;
export function makeSamsaraSafetyScoreFetcher(env: Env, token: string): SamsaraSafetyScoreFetcher {
  return async (startIso, endIso, driverIds) => {
    const batches = driverIds && driverIds.length ? chunk(driverIds, 100) : [undefined];
    const out: unknown[] = [];
    for (const batch of batches) {
      let after: string | undefined;
      do {
        const url = new URL("/safety-scores/drivers", env.SAMSARA_API_URL);
        url.searchParams.set("startTime", startIso);
        url.searchParams.set("endTime", endIso);
        if (batch) url.searchParams.set("driverIds", batch.join(","));
        if (after) url.searchParams.set("after", after);
        const res = await samsaraFetch(env, token, url);
        if (!res.ok) throw new Error(`Samsara API ${res.status}`);
        const page = (await res.json()) as {
          data?: unknown[];
          pagination?: { hasNextPage?: boolean; endCursor?: string };
        };
        if (Array.isArray(page.data)) out.push(...page.data);
        after = page.pagination?.hasNextPage ? page.pagination.endCursor : undefined;
      } while (after);
    }
    return { data: out };
  };
}

/** Driver Efficiency scores over a window (GET /driver-efficiency/drivers, dataFormats=score,raw,percentage) —
 *  driverIds batched ≤100, cursor-paginated. BETA endpoint. Scope: Read Driver Efficiency. Window rules
 *  (hour-truncated, start ≥1 day before end, end ≤3 h before now) are enforced by the caller. */
export type SamsaraDriverEfficiencyFetcher = (
  startIso: string,
  endIso: string,
  driverIds?: string[],
) => Promise<{ data: unknown[] }>;
export function makeSamsaraDriverEfficiencyFetcher(
  env: Env,
  token: string,
): SamsaraDriverEfficiencyFetcher {
  return async (startIso, endIso, driverIds) => {
    const batches = driverIds && driverIds.length ? chunk(driverIds, 100) : [undefined];
    const out: unknown[] = [];
    for (const batch of batches) {
      let after: string | undefined;
      do {
        const url = new URL("/driver-efficiency/drivers", env.SAMSARA_API_URL);
        url.searchParams.set("startTime", startIso);
        url.searchParams.set("endTime", endIso);
        url.searchParams.set("dataFormats", "score,raw,percentage");
        if (batch) url.searchParams.set("driverIds", batch.join(","));
        if (after) url.searchParams.set("after", after);
        const res = await samsaraFetch(env, token, url);
        if (!res.ok) throw new Error(`Samsara API ${res.status}`);
        const page = (await res.json()) as {
          data?: unknown[];
          pagination?: { hasNextPage?: boolean; endCursor?: string };
        };
        if (Array.isArray(page.data)) out.push(...page.data);
        after = page.pagination?.hasNextPage ? page.pagination.endCursor : undefined;
      } while (after);
    }
    return { data: out };
  };
}

/** Fetch current HOS clocks and key them by the driver's CURRENT vehicle (Samsara id) — for live route planning. */
export function makeSamsaraHosFetcher(env: Env, token: string) {
  return async (): Promise<
    Map<
      string,
      {
        driveRemainingMs: number | null;
        shiftRemainingMs: number | null;
        cycleRemainingMs: number | null;
        timeUntilBreakMs: number | null;
      }
    >
  > => {
    const rows = await listAllPages(env, token, "/fleet/hos/clocks", {});
    const out = new Map<
      string,
      {
        driveRemainingMs: number | null;
        shiftRemainingMs: number | null;
        cycleRemainingMs: number | null;
        timeUntilBreakMs: number | null;
      }
    >();
    for (const r of rows as Array<{
      currentVehicle?: { id?: string };
      clocks?: {
        drive?: { driveRemainingDurationMs?: number };
        shift?: { shiftRemainingDurationMs?: number };
        cycle?: { cycleRemainingDurationMs?: number };
        break?: { timeUntilBreakDurationMs?: number };
      };
    }>) {
      const vid = r.currentVehicle?.id;
      if (!vid) continue;
      const c = r.clocks ?? {};
      out.set(String(vid), {
        driveRemainingMs: c.drive?.driveRemainingDurationMs ?? null,
        shiftRemainingMs: c.shift?.shiftRemainingDurationMs ?? null,
        cycleRemainingMs: c.cycle?.cycleRemainingDurationMs ?? null,
        timeUntilBreakMs: c.break?.timeUntilBreakDurationMs ?? null,
      });
    }
    return out;
  };
}
