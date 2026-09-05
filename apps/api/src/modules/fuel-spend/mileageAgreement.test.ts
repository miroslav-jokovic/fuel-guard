import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { getMileageAgreement, wholeMonthsIn } from "./mileageAgreement.js";

/**
 * The cross-source mileage check, assembled (M5, plan Q3).
 *
 * The comparison itself is proved in `packages/shared/src/fuelSpend/mileageAgreement.test.ts`. What
 * is only testable here is the part a reader would never see going wrong:
 *
 *   • **whole calendar months only.** IFTA is published per month and cannot be cut finer, so half a
 *     month of allocated miles against a whole month of jurisdiction miles reads as a 50% collapse
 *     that is an artefact of the window and nothing else;
 *   • **the two sides cover the same days.** The rollup is read over the MONTHS' span, not the
 *     caller's, or a window starting mid-month compares a part-month with a whole one;
 *   • the read is org-scoped, because the service role bypasses RLS.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

interface SpendDay { day: string; miles: number }
interface IftaRow { vehicle_id: string; total_meters: number; period_year: number; period_month: number }

/** 1,609,344 m = 1,000 miles. */
const ifta = (year: number, month: number, miles: number, vehicleId = "v1"): IftaRow => ({
  vehicle_id: vehicleId,
  total_meters: miles * 1609.344,
  period_year: year,
  period_month: month,
});

/**
 * ⚠ Function fixtures. `supabaseRecorder` records filters and does NOT apply them, so a flat array
 * answers July's question with August's rows — and every assertion about WHICH months were compared
 * would pass for an implementation that ignored the window entirely.
 */
const seed = (days: SpendDay[], rows: IftaRow[]) =>
  createSupabaseRecorder({
    tables: {
      fuel_spend_days: (q) => {
        const at = (method: "gte" | "lte") =>
          q.ops.find((o) => o.method === method && o.args[0] === "day")?.args[1] as string | undefined;
        const lo = at("gte");
        const hi = at("lte");
        return days.filter((d) => (lo === undefined || d.day >= lo) && (hi === undefined || d.day <= hi));
      },
      samsara_ifta_jurisdiction_miles: (q) => {
        const eq = (col: string) => q.ops.find((o) => o.method === "eq" && o.args[0] === col)?.args[1];
        const y = eq("period_year");
        const m = eq("period_month");
        return rows.filter((r) => (y === undefined || r.period_year === y) && (m === undefined || r.period_month === m));
      },
    },
  });

describe("wholeMonthsIn", () => {
  it("takes only the months lying entirely inside the window", () => {
    expect(wholeMonthsIn("2026-06-15", "2026-09-10").map((m) => m.key)).toEqual(["2026-07", "2026-08"]);
  });

  it("takes a month whose ends are exactly the window's", () => {
    expect(wholeMonthsIn("2026-07-01", "2026-07-31").map((m) => m.key)).toEqual(["2026-07"]);
  });

  it("finds nothing in a window shorter than a month", () => {
    // A one-week report has nothing to check, which is not the same as its miles agreeing.
    expect(wholeMonthsIn("2026-08-10", "2026-08-16")).toEqual([]);
  });
});

describe("getMileageAgreement", () => {
  const JULY_DAYS = [{ day: "2026-07-10", miles: 1_549_942 }];
  const AUG_DAYS = [{ day: "2026-08-10", miles: 1_696_637 }];
  const REFERENCE = [ifta(2026, 7, 1_551_133), ifta(2026, 8, 1_634_889)];

  it("scopes every tenant query to one organization", async () => {
    const rec = seed([...JULY_DAYS, ...AUG_DAYS], REFERENCE);
    await getMileageAgreement(rec.client, ORG, "2026-07-01", "2026-08-31");
    expectOrgScoped(rec, ORG);
  });

  it("reproduces the two months the plan measured on production", async () => {
    const rec = seed([...JULY_DAYS, ...AUG_DAYS], REFERENCE);
    const a = await getMileageAgreement(rec.client, ORG, "2026-07-01", "2026-08-31");
    expect(a.monthsChecked).toEqual(["2026-07", "2026-08"]);
    expect(a.months[0]!.verdict).toBe("agrees");
    expect(a.months[1]!.verdict).toBe("diverges");
    expect(a.worst!.month).toBe("2026-08");
  });

  it("ignores the part-months at the edges of the window", async () => {
    // June's and September's rollup miles are real and their IFTA months are not fully inside the
    // window, so comparing them would manufacture a divergence out of the dates.
    const rec = seed(
      [{ day: "2026-06-20", miles: 900_000 }, ...JULY_DAYS, { day: "2026-09-02", miles: 100_000 }],
      REFERENCE,
    );
    const a = await getMileageAgreement(rec.client, ORG, "2026-06-15", "2026-09-10");
    expect(a.monthsChecked).toEqual(["2026-07", "2026-08"]);
    expect(a.months.find((m) => m.month === "2026-07")!.miles).toBe(1_549_942);
  });

  it("reads the rollup over the MONTHS' span, not the caller's window", async () => {
    // The window starts on the 15th; July's total must still be the whole of July, or our side is a
    // part-month compared against the reference's whole one.
    const rec = seed([], REFERENCE);
    await getMileageAgreement(rec.client, ORG, "2026-06-15", "2026-08-31");
    const q = rec.forTable("fuel_spend_days")[0]!;
    expect(q.ops.find((o) => o.method === "gte" && o.args[0] === "day")!.args[1]).toBe("2026-07-01");
    expect(q.ops.find((o) => o.method === "lte" && o.args[0] === "day")!.args[1]).toBe("2026-08-31");
  });

  it("says the window was too short rather than that the miles agree", async () => {
    const rec = seed(AUG_DAYS, REFERENCE);
    const a = await getMileageAgreement(rec.client, ORG, "2026-08-10", "2026-08-16");
    expect(a.windowTooShort).toBe(true);
    expect(a.verdict).toBe("unmeasurable");
    expect(a.concern).toBeNull();
    // Nothing was read at all — there was no question to ask.
    expect(rec.forTable("fuel_spend_days")).toEqual([]);
  });

  it("reports UNMEASURABLE when the reference feed has nothing for a month", async () => {
    const rec = seed(JULY_DAYS, []);
    const a = await getMileageAgreement(rec.client, ORG, "2026-07-01", "2026-07-31");
    expect(a.months[0]!.verdict).toBe("unmeasurable");
    expect(a.concern).toMatch(/nothing standing beside it/);
  });
});
