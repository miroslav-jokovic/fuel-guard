import { describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * Per-unit maintenance cost and its coverage bound (FLEETPAL-INTEGRATION-PLAN.md F9b).
 *
 * Two things are proved here and nowhere else, and both are rules rather than arithmetic:
 *
 *   1. **D-FP4's refusal.** A cost figure without its coverage ratio is the plausible-but-wrong
 *      number this whole integration is shaped around — FleetPal knows what the shop spent THROUGH
 *      FLEETPAL, the ledger knows what the company spent through every channel, and summing the
 *      first in front of somebody who reads it as the second is the failure D-FIN10 exists for. So
 *      a window whose ledger has an unswept month must produce NO cost at all.
 *   2. **The duplicate-unit sum.** Eight VINs appear twice in FleetPal's unit list (F4,
 *      2026-09-21). A read that took the first matching unit would report half the repair spend for
 *      eight trucks, forever, and the only symptom would be a slightly low number.
 *
 * The bound's own arithmetic is proved pure in `packages/shared/src/fleetpal/coverage.test.ts`;
 * re-asserting it through HTTP would test the wiring twice and the rule not at all.
 */

const ORG = "org-1";
const VEHICLE = "44444444-4444-4444-8444-444444444444";

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: "user-1", orgId: ORG, role: "fleet_manager", email: "shop@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireSection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAnySection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { fleetpalCostRouter } = await import("./fleetpalCost.js");

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use("/api/maintenance", fleetpalCostRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await closeTestServer(server);
  }
}

/** August 2026's maintenance family, from the signed map in `tmsCost/glFamilies.ts`. */
const glAugust = [
  { period_start: "2026-08-01", period_end: "2026-08-31", swept_at: "2026-09-01T00:00:00Z",
    post_module: "AP", glid: "30230000", line_count: 12, net_amount: 10_000, abs_amount: 10_000 },
  // ⚠ An account OUTSIDE the maintenance family, in the same month. It must not reach the
  // denominator — the family is a signed 15-account map, not "everything the ledger holds".
  { period_start: "2026-08-01", period_end: "2026-08-31", swept_at: "2026-09-01T00:00:00Z",
    post_module: "AP", glid: "40230000", line_count: 4, net_amount: 999_999, abs_amount: 999_999 },
];

const invoice = (over: Record<string, unknown> = {}) => ({
  id: "inv-1", invoice_number: "WI012764", invoice_type: "STANDARD",
  invoice_date: "2026-08-04", amount: 1000, ...over,
});

const voucher = (over: Record<string, unknown> = {}) => ({
  id: "v-1", invoice_number: "WI012764", vendor_id: "V1",
  invoice_date: "2026-08-04", distribution_date: "2026-08-04", amount: 1000, ...over,
});

const repair = (over: Record<string, unknown> = {}) => ({
  id: "sh-1", fleetpal_id: "SH1", work_order_reference: "WO-5331", component: "013",
  description: "Alternator", source: "MANUAL",
  started: "2026-08-20T17:00:00Z", completed: "2026-08-20T21:30:00Z",
  total: 1808.1, total_parts: 1200.05, total_labor: 500, total_fees: 50, total_tax: 33.76,
  total_services: 24.29, total_labor_hours: 4.5, odometer: 663_000_000, ...over,
});

/**
 * ⚠ Function fixtures, never flat arrays. `supabaseRecorder` does NOT filter, so a flat array
 * answers every window with the same rows — and a test whose fixture cannot discriminate greens a
 * read that ignored its own filters.
 */
function recorderWith(opts: {
  gl?: unknown[];
  invoices?: unknown[];
  vouchers?: unknown[];
  units?: unknown[];
  repairs?: unknown[];
  miles?: unknown[];
} = {}) {
  return createSupabaseRecorder({
    tables: {
      mcleod_gl_totals: () => ({ data: opts.gl ?? glAugust, error: null }),
      fleetpal_po_invoices: () => ({ data: opts.invoices ?? [invoice()], error: null }),
      mcleod_ap_vouchers: () => ({ data: opts.vouchers ?? [voucher()], error: null }),
      fleetpal_units: () => ({ data: opts.units ?? [{ fleetpal_id: "U1" }], error: null }),
      fleetpal_service_history: () => ({ data: opts.repairs ?? [repair()], error: null }),
      samsara_ifta_jurisdiction_miles: () => ({ data: opts.miles ?? [], error: null }),
    },
  });
}

const AUG = "from=2026-08-01&to=2026-09-01";

describe("the coverage bound over HTTP", () => {
  it("answers with the bound, its exclusions and the unmatched-unit count", async () => {
    rec = recorderWith();
    const body = await withServer(async (base) =>
      (await fetch(`${base}/api/maintenance/fleetpal/coverage?${AUG}`)).json(),
    ) as { ok: boolean; months: Array<Record<string, number | null>>; unmatchedUnits: number; printable: boolean };

    expect(body.ok).toBe(true);
    expect(body.printable).toBe(true);
    const august = body.months[0]!;
    // 1,000 confirmed against a 10,000 maintenance family — and NOT against the 1,009,999 the
    // ledger holds in total for the month, which is the out-of-family account above.
    expect(august.glMaintenance).toBe(10_000);
    expect(august.confirmedInLedger).toBe(1000);
    expect(august.ratioLowerBound).toBe(0.1);
    expect(body.unmatchedUnits).toBe(0);
  });

  it("reads every table org-scoped — the service role bypasses RLS", async () => {
    rec = recorderWith();
    await withServer(async (base) => fetch(`${base}/api/maintenance/fleetpal/coverage?${AUG}`));
    expectOrgScoped(rec, ORG);
  });

  it("⚠ reports an unswept month's denominator as NULL, not as a zero", async () => {
    // The bound is null either way — `computeCoverage` treats a zero denominator as unanswerable —
    // so the REFUSAL cannot see this difference, and dropping the null left every other test green.
    // What the difference reaches is the page: a null prints a dash and a 0 prints "$0.00", which
    // says the company spent nothing on maintenance in August. It did not; we have not swept it.
    rec = recorderWith({ gl: [] });
    const body = (await withServer(async (base) =>
      (await fetch(`${base}/api/maintenance/fleetpal/coverage?${AUG}`)).json(),
    )) as { months: Array<Record<string, number | null>>; printable: boolean };
    expect(body.months[0]!.glMaintenance).toBeNull();
    expect(body.months[0]!.ratioLowerBound).toBeNull();
    expect(body.printable).toBe(false);
  });

  it("refuses a window that is not two wall-clock dates in order", async () => {
    rec = recorderWith();
    const codes = await withServer(async (base) => [
      (await fetch(`${base}/api/maintenance/fleetpal/coverage?from=2026-08-01`)).status,
      (await fetch(`${base}/api/maintenance/fleetpal/coverage?from=2026-09-01&to=2026-08-01`)).status,
      (await fetch(`${base}/api/maintenance/fleetpal/coverage?from=last-month&to=now`)).status,
    ]);
    expect(codes).toEqual([400, 400, 400]);
  });
});

describe("⚠ D-FP4: no cost figure without its coverage ratio", () => {
  it("⚠ refuses the cost with 409 when a month of the window has no swept ledger", async () => {
    // The ledger answers for nothing in this window. That is a fact about OUR data, not about the
    // shop, so the honest response is no number — not a zero and not a cost figure standing alone.
    rec = recorderWith({ gl: [] });
    const res = await withServer(async (base) =>
      fetch(`${base}/api/maintenance/units/tractor/${VEHICLE}/maintenance?${AUG}`),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("coverage_unavailable");
  });

  it("⚠ and the refusal carries NO cost anywhere in the body", async () => {
    // A 409 whose body still held the totals would be one careless client away from printing them.
    rec = recorderWith({ gl: [] });
    const raw = await withServer(async (base) =>
      (await fetch(`${base}/api/maintenance/units/tractor/${VEHICLE}/maintenance?${AUG}`)).text(),
    );
    expect(raw).not.toContain("1808.1");
    expect(raw).not.toContain("totals");
  });

  it("⚠ ONE unswept month in a two-month window refuses the whole window", async () => {
    // July is swept, August is not. A cost figure covering both beside a ratio covering one is the
    // figure that looks more trustworthy than a refusal, which is exactly why there is no such path.
    rec = recorderWith({
      gl: [{ period_start: "2026-07-01", period_end: "2026-07-31", swept_at: "2026-08-01T00:00:00Z",
             post_module: "AP", glid: "30230000", line_count: 3, net_amount: 5_000, abs_amount: 5_000 }],
    });
    const res = await withServer(async (base) =>
      fetch(`${base}/api/maintenance/units/tractor/${VEHICLE}/maintenance?from=2026-07-01&to=2026-09-01`),
    );
    expect(res.status).toBe(409);
  });

  it("answers with the cost AND the coverage together when the bound exists", async () => {
    rec = recorderWith();
    const body = (await withServer(async (base) =>
      (await fetch(`${base}/api/maintenance/units/tractor/${VEHICLE}/maintenance?${AUG}`)).json(),
    )) as { ok: boolean; totals: Record<string, number | null>; coverage: unknown[]; unmatchedUnits: number };
    expect(body.ok).toBe(true);
    expect(body.totals.total).toBe(1808.1);
    // D-FP4 and D-FP14: the ratio and the unmatched count travel WITH the money, in one response.
    expect(body.coverage).toHaveLength(1);
    expect(body.unmatchedUnits).toBe(0);
  });
});

describe("⚠ one vehicle can be several FleetPal units", () => {
  it("⚠ asks for EVERY mapped unit id, not the first — eight trucks have two", async () => {
    rec = recorderWith({
      units: [{ fleetpal_id: "U-OLD" }, { fleetpal_id: "U-NEW" }],
      repairs: [repair({ fleetpal_id: "SH-OLD" }), repair({ id: "sh-2", fleetpal_id: "SH-NEW", total: 500 })],
    });
    const body = (await withServer(async (base) =>
      (await fetch(`${base}/api/maintenance/units/tractor/${VEHICLE}/maintenance?${AUG}`)).json(),
    )) as { totals: Record<string, number | null>; fleetpalUnitIds: string[]; repairCount: number };

    expect(body.fleetpalUnitIds).toEqual(["U-OLD", "U-NEW"]);
    expect(body.repairCount).toBe(2);
    expect(body.totals.total).toBe(2308.1);

    // The filter itself, not just its result: the read must be an `in` over both ids. A fixture
    // cannot fail an `.eq()` on the first id, because the recorder does not filter — so the QUERY
    // is what gets asserted.
    const historyQuery = rec.queries.find((q) => q.table === "fleetpal_service_history")!;
    expect(JSON.stringify(historyQuery.filters())).toContain("U-NEW");
  });

  it("a unit mapped to nothing answers with an empty file rather than an error", async () => {
    // 48 of 474 units are unmatched (F4) and a vehicle nobody linked is the ordinary case, not a
    // failure. The unmatched COUNT beside it is what tells the reader why the file is empty.
    rec = recorderWith({ units: [] });
    const body = (await withServer(async (base) =>
      (await fetch(`${base}/api/maintenance/units/tractor/${VEHICLE}/maintenance?${AUG}`)).json(),
    )) as { ok: boolean; repairCount: number; totals: Record<string, number | null> };
    expect(body.ok).toBe(true);
    expect(body.repairCount).toBe(0);
    expect(body.totals.total).toBeNull();
  });
});

describe("what the unit file reports", () => {
  it("⚠ prints a null total as null, never as a zero (D-FIN10)", async () => {
    rec = recorderWith({ repairs: [repair({ total_fees: null, total_tax: null })] });
    const body = (await withServer(async (base) =>
      (await fetch(`${base}/api/maintenance/units/tractor/${VEHICLE}/maintenance?${AUG}`)).json(),
    )) as { totals: Record<string, number | null> };
    // "No fees were recorded" and "the fees were $0.00" are different claims, and only one of them
    // is in the data.
    expect(body.totals.fees).toBeNull();
    expect(body.totals.tax).toBeNull();
    expect(body.totals.parts).toBe(1200.05);
  });

  it("⚠ converts the odometer out of canonical metres at this one read site (D-FP9)", async () => {
    rec = recorderWith();
    const body = (await withServer(async (base) =>
      (await fetch(`${base}/api/maintenance/units/tractor/${VEHICLE}/maintenance?${AUG}`)).json(),
    )) as { repairs: Array<{ odometerMiles: number | null }> };
    // 663,000,000 metres is 411,969 miles — the real top of this fleet's range, and the reason
    // 0349 made this column `bigint`. ⚠ The plan and 0349's header both round it to "412,000";
    // asserting that round number here failed, which is the assertion doing its job. A conversion
    // is pinned to what the divisor produces (1609.344 m/mi), never to a figure quoted in prose.
    expect(body.repairs[0]!.odometerMiles).toBe(411_969);
  });

  it("⚠ counts a repair stamped at ONE INSTANT as one day out of service, not zero", async () => {
    // The truck was in the shop. Zero days out of service is what a repair that never happened
    // costs, and the two must not print the same.
    //
    // ⚠ The default fixture CANNOT prove this, and finding that out is why the case is explicit.
    // It runs 17:00 to 21:30, and `Math.ceil(4.5h / 24h)` is already 1 — so deleting the
    // `Math.max(1, ...)` floor left every test green. The floor is only load-bearing when the two
    // stamps are EQUAL, which is what a shop that stamps both at close actually sends.
    rec = recorderWith({
      repairs: [repair({ started: "2026-08-20T21:30:00Z", completed: "2026-08-20T21:30:00Z" })],
    });
    const body = (await withServer(async (base) =>
      (await fetch(`${base}/api/maintenance/units/tractor/${VEHICLE}/maintenance?${AUG}`)).json(),
    )) as { downtimeDays: number; repairs: Array<{ downtimeDays: number | null }> };
    expect(body.repairs[0]!.downtimeDays).toBe(1);
    expect(body.downtimeDays).toBe(1);
  });

  it("reports downtime as null when the vendor never stamped one end", async () => {
    // "We do not know how long it was out" is a third answer, and rendering it as 0 or 1 would
    // both be claims the data does not make.
    rec = recorderWith({ repairs: [repair({ started: null })] });
    const body = (await withServer(async (base) =>
      (await fetch(`${base}/api/maintenance/units/tractor/${VEHICLE}/maintenance?${AUG}`)).json(),
    )) as { repairs: Array<{ downtimeDays: number | null }> };
    expect(body.repairs[0]!.downtimeDays).toBeNull();
  });

  it("⚠ leaves cost per mile null when the mileage feed is silent, rather than dividing by zero", async () => {
    rec = recorderWith({ miles: [] });
    const body = (await withServer(async (base) =>
      (await fetch(`${base}/api/maintenance/units/tractor/${VEHICLE}/maintenance?${AUG}`)).json(),
    )) as { miles: number | null; costPerMile: number | null };
    expect(body.miles).toBeNull();
    expect(body.costPerMile).toBeNull();
  });

  it("computes cost per mile when the feed has answered", async () => {
    rec = recorderWith({
      miles: [{ vehicle_id: VEHICLE, total_meters: 16_093_440 }], // 10,000 miles
    });
    const body = (await withServer(async (base) =>
      (await fetch(`${base}/api/maintenance/units/tractor/${VEHICLE}/maintenance?${AUG}`)).json(),
    )) as { miles: number | null; costPerMile: number | null };
    expect(body.miles).toBe(10_000);
    expect(body.costPerMile).toBeCloseTo(0.1808, 4);
  });

  it("⚠ a trailer's cost per mile is null — IFTA mileage is per VEHICLE and a trailer has none", async () => {
    rec = recorderWith({ miles: [{ vehicle_id: VEHICLE, total_meters: 16_093_440 }] });
    const body = (await withServer(async (base) =>
      (await fetch(`${base}/api/maintenance/units/trailer/${VEHICLE}/maintenance?${AUG}`)).json(),
    )) as { miles: number | null; costPerMile: number | null; totals: Record<string, number | null> };
    expect(body.miles).toBeNull();
    expect(body.costPerMile).toBeNull();
    // The COST is still reported — a trailer has maintenance, it just has no miles.
    expect(body.totals.total).toBe(1808.1);
  });

  it("refuses a kind that is neither tractor nor trailer", async () => {
    rec = recorderWith();
    const status = await withServer(async (base) =>
      (await fetch(`${base}/api/maintenance/units/forklift/${VEHICLE}/maintenance?${AUG}`)).status,
    );
    expect(status).toBe(400);
  });
});
