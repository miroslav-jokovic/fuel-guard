import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { testEnv } from "../../testing/testEnv.js";
import { syncTrailersFromSamsara } from "./samsaraTrailerSync.js";

/**
 * The Samsara trailer sync when the carrier's TMS masters the roster (D-MR5).
 *
 * Trailers are the clearest case of the three. Measured against production on 2026-08-24, across 211
 * trailer rows, Samsara supplies `make` for 0, `model` for 0, `year` for 0 and `plate` for 9 — and
 * the sync writes all four unconditionally, so it puts an explicit null into each of them on every
 * tick for 202 of the 211. That is invisible while it is the only writer of those columns and it
 * erases the roster the moment McLeod is the other one.
 *
 * There is nothing to carve out in return: `dbo.trailer` has no `model` column at all, so the one
 * field Samsara could in principle own uniquely is a field neither system holds a value for. Link
 * mode therefore writes the link and stops.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
// A token so the best-effort GPS co-location pass exits on its own read rather than by throwing; it
// finds no vehicles to pair against and returns before any HTTP call.
const env = testEnv({ SAMSARA_API_TOKEN: "t" });

/** One gateway trailer as Samsara actually reports them here: a name, and nothing else populated. */
const SAMSARA = [{ id: "SA1", name: "R532159" }];

const seed = (trailers: Record<string, unknown>[], master: boolean) =>
  createSupabaseRecorder({
    tables: {
      trailers,
      org_integrations: master
        ? [{ org_id: ORG, provider: "mcleod", enabled: true, config: { roster_master: true } }]
        : [],
    },
  });

const run = (rec: ReturnType<typeof seed>) =>
  syncTrailersFromSamsara(rec.client, env, ORG, async () => SAMSARA, async () => ({ data: [] }));

/** A McLeod-owned trailer carrying the identity McLeod wrote, not yet linked to its gateway. */
const mcleodTrailer = {
  id: "t-1",
  org_id: ORG,
  unit_number: "R532159",
  make: "Utility",
  year: 2019,
  plate: "TR9021",
  status: "active",
  samsara_asset_id: null,
  pairing_source: null,
};

describe("samsara trailer sync under TMS roster mastery", () => {
  it("writes the telematics link and nothing else", async () => {
    const rec = seed([mcleodTrailer], true);
    await run(rec);
    const p = rec.writtenRows("trailers")[0]!;
    expect(Object.keys(p)).toEqual(["samsara_asset_id"]);
    expect(p.samsara_asset_id).toBe("SA1");
  });

  it("cannot null the make, year and plate McLeod owns", async () => {
    const rec = seed([mcleodTrailer], true);
    await run(rec);
    for (const w of rec.writtenRows("trailers")) {
      expect(w).not.toHaveProperty("make");
      expect(w).not.toHaveProperty("model");
      expect(w).not.toHaveProperty("year");
      expect(w).not.toHaveProperty("plate");
    }
  });

  it("reports a trailer the fleet list does not contain instead of inventing a 50-gallon reefer tank", async () => {
    const rec = seed([], true);
    const r = await run(rec);
    expect(r.created).toBe(0);
    expect(r.unlinked).toEqual(["R532159"]);
    expect(rec.writes()).toEqual([]);
  });

  it("is completely inert for an org with no TMS — full behaviour is unchanged", async () => {
    const rec = seed([], false);
    const r = await run(rec);
    expect(r.created).toBe(1);
    expect(r.unlinked).toBeUndefined();
    expect(rec.writtenRows("trailers")[0]).toMatchObject({ unit_number: "R532159", reefer_tank_capacity_gal: 50 });
  });

  it("scopes every query to one org — the API reads with the service role, which bypasses RLS", async () => {
    const rec = seed([mcleodTrailer], true);
    await run(rec);
    expectOrgScoped(rec, ORG);
  });
});
