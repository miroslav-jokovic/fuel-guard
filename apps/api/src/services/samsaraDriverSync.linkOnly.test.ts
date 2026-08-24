import { describe, it, expect } from "vitest";
import { createSupabaseRecorder } from "../testing/supabaseRecorder.js";
import { syncDriversFromSamsara } from "./samsaraDriverSync.js";

/**
 * The Samsara driver sync when the carrier's TMS masters the roster.
 *
 * This is the half of the cutover that PROTECTS features rather than adding one. The obvious way to
 * "switch drivers to McLeod" is to turn this sync off, and that would be quietly destructive:
 * `samsara_driver_id` is the join key seventeen call sites in hosSync alone dereference, and PHONE is
 * a field McLeod does not have at all — 0 of its 1,463 driver rows carry one, while 164 of FuelGuard's
 * 166 active drivers do and every one came from here.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const env = { SAMSARA_API_TOKEN: "t" } as never;

const seed = (drivers: Record<string, unknown>[], master: boolean) =>
  createSupabaseRecorder({
    tables: {
      drivers,
      org_integrations: master
        ? [{ org_id: ORG, provider: "mcleod", enabled: true, config: { roster_master: true } }]
        : [],
    },
  });

const samsara = [{ id: "S1", name: "Angel Cora", phone: "+15551234567", username: "acora", isDeactivated: false }];

describe("samsara driver sync under TMS roster mastery", () => {
  it("keeps writing the telematics link and the phone number", async () => {
    const rec = seed(
      [{ id: "d-1", org_id: ORG, full_name: "Angel Cora", phone: null, samsara_driver_id: null,
         identity_source: "mcleod", status: "active", cdl_number: "X1" }],
      true,
    );
    await syncDriversFromSamsara(rec.client, env, ORG, async () => samsara);
    const p = rec.writtenRows("drivers")[0]!;
    expect(p.samsara_driver_id).toBe("S1");   // the join key HOS, idle and scores all follow
    expect(p.phone).toBe("+15551234567");     // the field McLeod cannot supply
  });

  it("writes NOTHING McLeod owns — not the name, not the licence", async () => {
    const rec = seed(
      [{ id: "d-1", org_id: ORG, full_name: "Angel Cora", phone: null, samsara_driver_id: null,
         identity_source: "mcleod", status: "active", cdl_number: "X1" }],
      true,
    );
    await syncDriversFromSamsara(rec.client, env, ORG, async () => samsara);
    const p = rec.writtenRows("drivers")[0]!;
    expect(p).not.toHaveProperty("full_name");
    expect(p).not.toHaveProperty("cdl_number");
    expect(p).not.toHaveProperty("status");
  });

  it("reports a Samsara driver matching nobody instead of inventing a row", async () => {
    // Somebody is driving who is not on the carrier's HR roster. That is a finding for a human.
    const rec = seed([], true);
    const r = await syncDriversFromSamsara(rec.client, env, ORG, async () => samsara);
    expect(r.created).toBe(0);
    expect(r.unlinked).toEqual(["Angel Cora"]);
    expect(rec.writes()).toEqual([]);
  });

  it("does not deactivate — McLeod owns retirement and the retention rules that go with it", async () => {
    const rec = seed(
      [{ id: "d-stale", org_id: ORG, full_name: "Gone Person", samsara_driver_id: "S-OLD",
         identity_source: "mcleod", status: "active", phone: null, cdl_number: null }],
      true,
    );
    const r = await syncDriversFromSamsara(rec.client, env, ORG, async () => samsara);
    expect(r.deactivated).toBe(0);
    expect(rec.writtenRows("drivers").some((w) => w.status === "inactive")).toBe(false);
  });

  it("still refuses to overwrite an office-owned row, exactly as in full mode", async () => {
    const rec = seed(
      // Must actually MATCH the Samsara driver, or the test proves nothing: same name, so it is
      // found by the name key, and the assertion is about what happens next.
      [{ id: "d-1", org_id: ORG, full_name: "Angel Cora", phone: "+15559999999",
         samsara_driver_id: null, identity_source: "manual", status: "active", cdl_number: "X1" }],
      true,
    );
    await syncDriversFromSamsara(rec.client, env, ORG, async () => samsara);
    const p = rec.writtenRows("drivers")[0]!;
    expect(Object.keys(p)).toEqual(["samsara_driver_id"]); // the LINK only; not even the phone
  });

  it("is completely inert for an org with no TMS — full behaviour is unchanged", async () => {
    const rec = seed([], false);
    const r = await syncDriversFromSamsara(rec.client, env, ORG, async () => samsara);
    expect(r.created).toBe(1);        // creates, as it always has
    expect(r.unlinked).toBeUndefined();
  });
});
