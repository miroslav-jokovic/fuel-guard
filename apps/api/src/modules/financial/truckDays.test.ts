import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../testing/postgrestFixture.js";
import { getTruckDays } from "./truckDays.js";

/**
 * The truck-day census over the staged tractors (P2, D-TP3). The fixture is shaped like the sandbox
 * on 2026-10-21: a running company truck, one sold mid-July, a contractor's truck, a Scorpio truck,
 * one of the 42 reserved unit numbers, and another carrier's tractor that must not be counted.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER = "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f";

const row = (tractor_id: string, over: Record<string, unknown> = {}) => ({
  org_id: ORG,
  tractor_id,
  company_id: "TMS",
  in_service_on: "2024-01-15",
  out_of_service_on: null,
  purchased_on: "2024-01-10",
  model_year: "2024",
  service_status: "A",
  tractor_status: "A",
  owner_id: "SILVMEIL",
  pay_owner: "D",
  ...over,
});

const TRACTORS = [
  row("552"),
  row("418", { out_of_service_on: "2026-07-16", service_status: "I", tractor_status: "I" }),
  row("830", { owner_id: "ALLARONY", pay_owner: "O" }),
  row("905", { owner_id: "SCORELIL", pay_owner: "B" }),
  row("809", { purchased_on: null, model_year: null, in_service_on: "2026-09-04" }),
  row("552", { org_id: OTHER }),
];

describe("getTruckDays", () => {
  it("counts July's days per truck from McLeod's dates, split by whose truck it is", async () => {
    const rec = createSupabaseRecorder({ tables: { mcleod_tractor_periods: postgrestFixture(TRACTORS) } });
    const r = await getTruckDays(rec.client as unknown as SupabaseClient, ORG, "2026-07-01", "2026-08-01");
    expect(r.trucks.map((t) => [t.tractor_id, t.days, t.ownership])).toEqual([
      ["418", 15, "carrier"],
      ["552", 31, "carrier"],
      ["830", 31, "owner_operator"],
      ["905", 31, "owner_operator"],
    ]);
    expect(r.carrierDays).toBe(46);
    expect(r.ownerOperatorDays).toBe(62);
    expect(r.excluded).toEqual({ reserved: 1, undated: 0 });
    expectOrgScoped(rec, ORG);
  });

  it("takes the accounting surface's exclusive `to`", async () => {
    const rec = createSupabaseRecorder({ tables: { mcleod_tractor_periods: postgrestFixture(TRACTORS) } });
    const r = await getTruckDays(rec.client as unknown as SupabaseClient, ORG, "2026-07-01", "2026-07-02");
    expect(r.days).toBe(4);
  });
});
