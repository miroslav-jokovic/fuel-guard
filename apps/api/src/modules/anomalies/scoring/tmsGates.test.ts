import { describe, expect, it } from "vitest";
import { deriveDriverHomeAtFill } from "./tmsGates.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";

/**
 * "Was this fuel bought while the driver was home?" — the one reader of `driver_time_off` before home
 * time had a writer (HOME-TIME-PLAN §3.7). Since 0597 a period can be CANCELED, and a canceled period
 * keeps a null `end_at`, which this rule reads as "still off": so it must skip canceled rows by name.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "66666666-8888-4999-8aaa-bbbbbbbbbbb1";
const FILL = "2026-11-13T15:00:00.000Z";

const off = (o: Record<string, unknown> = {}) => ({
  id: "50000000-0000-4000-8000-00000000000a",
  org_id: ORG,
  driver_id: DRIVER,
  provider: "silvicom",
  start_at: "2026-11-10T14:00:00.000Z",
  end_at: null,
  canceled_at: null,
  ...o,
});
const recorder = (rows: Record<string, unknown>[], tmsOn = true) =>
  createSupabaseRecorder({
    tables: {
      org_integrations: postgrestFixture(tmsOn ? [{ org_id: ORG, provider: "mcleod", enabled: true }] : []),
      driver_time_off: postgrestFixture(rows),
    },
  });

describe("deriveDriverHomeAtFill", () => {
  it("says yes for a fill inside an open home-time period, with every read the carrier's own", async () => {
    const rec = recorder([off()]);
    expect(await deriveDriverHomeAtFill(rec.client, ORG, DRIVER, FILL)).toBe(true);
    expectOrgScoped(rec, ORG);
  });

  it("says no when the only period was canceled — a home time marked by mistake is not home time", async () => {
    const rec = recorder([off({ canceled_at: "2026-11-10T15:00:00.000Z" })]);
    expect(await deriveDriverHomeAtFill(rec.client, ORG, DRIVER, FILL)).toBe(false);
    expect(rec.forTable("driver_time_off")[0]!.filters()).toContainEqual({ col: "canceled_at", val: null });
  });

  it("says no for another driver's period and for a period that starts more than a day after the fill", async () => {
    expect(await deriveDriverHomeAtFill(recorder([off({ driver_id: "66666666-8888-4999-8aaa-bbbbbbbbbbb2" })]).client, ORG, DRIVER, FILL)).toBe(false);
    expect(await deriveDriverHomeAtFill(recorder([off({ start_at: "2026-11-15T14:00:00.000Z" })]).client, ORG, DRIVER, FILL)).toBe(false);
  });

  it("does not evaluate at all for a carrier with no enabled McLeod feed", async () => {
    const rec = recorder([off()], false);
    expect(await deriveDriverHomeAtFill(rec.client, ORG, DRIVER, FILL)).toBeUndefined();
    expect(rec.forTable("driver_time_off")).toEqual([]);
  });
});
