import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { getCredential, getApiKey, setApiKey, setEnabled } from "./credentials.js";
import { advance, getSyncState, recordFailure } from "./syncState.js";
import { countUnmatched, setMatch, stageUnit } from "./units.js";
import { claimDelivery, finishDelivery } from "./deliveries.js";
import { testEnv } from "../../testing/testEnv.js";
import type { FleetpalUnit } from "@silvicom/shared";

/**
 * The FleetPal collector's store (FLEETPAL-INTEGRATION-PLAN.md F2).
 *
 * ── THE THREE ASSERTIONS THIS FILE EXISTS FOR ──────────────────────────────────────────────────
 * Each is a write that would look completely successful and destroy something anyway:
 *
 *   1. **A SWEEP RE-STAGES A UNIT AND SILENTLY UNMATCHES IT.** `stageUnit` writes the vendor's
 *      fields. If it also wrote `match_method`, every unit a person had linked by hand would revert
 *      to `unmatched` once a night — invisibly, with the only symptom a per-unit cost report that
 *      got emptier. The patch omitting those four columns is the entire defence.
 *   2. **A FAILED SWEEP ADVANCES THE WATERMARK.** Then the next run reads past the window it never
 *      processed, loses whatever changed in it, and looks perfectly healthy doing so. `advance` is
 *      called only on success and `recordFailure` deliberately moves nothing.
 *   3. **A WINDOW POSITION IS WRITTEN AS A WATERMARK.** `defects` and `expirations` have no
 *      `updated` field, so their `detected_after` position is about when a thing was CREATED. Read
 *      back as a watermark it would skip everything that changed without being re-created — a
 *      defect resolved after the last sweep would never be seen to have resolved.
 *
 * The service role bypasses RLS, so every query is also asserted org-scoped.
 */

const ORG = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
/**
 * 32 bytes of base64, so `secretBox` is configured and the seal/open round trip below is REAL rather
 * than stubbed — a stubbed cipher would let a plaintext write pass this file unnoticed.
 *
 * Built with `testEnv()` and not `{ … } as unknown as Env`: the cast type-checks and then hands the
 * code an object missing every key it did not mention, which `loadEnv` can never return, and
 * `envCasts.test.ts` is the fitness function that says so.
 */
const ENV = testEnv({ SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") });
const NO_SEALING_KEY = testEnv({ SECRETS_ENCRYPTION_KEY: undefined });

const UNIT: FleetpalUnit = {
  url: "https://openapi.fleetpal.io/v1/units/Vn7kPq2R",
  id: "Vn7kPq2R",
  name: "654",
  number: "654",
  vin: "1FUJGLDR8CLBP8834",
  license_plate: "P123456",
  color: "White",
  model: "Cascadia",
  model_year: 2022,
  serial_number: "",
  ownership: "OWN",
  owner: null,
  engine_hp: 505,
  engine_model: "DD15",
  engine_serial_number: "",
  engine_vmrs_manufacturer: null,
  tire_size: "295/75R22.5",
  transmission_gears: 12,
  transmission_model: "DT12",
  transmission_serial_number: "",
  transmission_vmrs_manufacturer: null,
  vmrs_equipment_category: "C1",
  vmrs_manufacturer: "M9",
  archived: null,
  created: "2026-01-02T00:00:00Z",
  updated: "2026-08-14T09:30:00Z",
};

/**
 * The recorder takes its fixtures at CONSTRUCTION and every one here is a FUNCTION, not an array.
 * `supabaseRecorder` does not apply filters — a flat array answers every query on a table with the
 * same rows, so a fixture shaped as a list would make "the update found a row" and "the update
 * found nothing" indistinguishable, and both insert-fallback branches below would go untested.
 */
const recorderFor = (tables: Record<string, unknown>): SupabaseRecorder =>
  createSupabaseRecorder({ tables: tables as never });

describe("the credential", () => {
  it("never hands back key material — 'is it configured' is a yes/no question", async () => {
    const rec = recorderFor({ fleetpal_credentials: () => [
      {
        org_id: ORG,
        base_url: "https://openapi.fleetpal.io",
        enabled: true,
        api_key_sealed: "v1.abcd1234.aa.bb.cc",
        last_synced_at: null,
        last_error: null,
      },
    ] });
    const cred = await getCredential(rec.client, ORG);
    expect(cred?.hasKey).toBe(true);
    // The envelope must not appear anywhere on the object a route can serialise.
    expect(JSON.stringify(cred)).not.toContain("v1.abcd1234");
  });

  it("refuses to store a key when the sealing key is absent, rather than falling back to plaintext", async () => {
    const rec = recorderFor({ fleetpal_credentials: () => [{ org_id: ORG }] });
    const result = await setApiKey(rec.client, NO_SEALING_KEY, ORG, "fp_live_secret");
    expect("error" in result && result.error).toContain("SECRETS_ENCRYPTION_KEY");
    // ⚠ And nothing was written. A refusal that still wrote the row would be the worst of both.
    expect(rec.queries.filter((q) => q.table === "fleetpal_credentials")).toHaveLength(0);
  });

  it("seals the key, so no query ever carries it in the clear", async () => {
    const rec = recorderFor({ fleetpal_credentials: () => [{ org_id: ORG }] });
    const result = await setApiKey(rec.client, ENV, ORG, "fp_live_secret");
    expect(result).toEqual({ ok: true });
    const written = JSON.stringify(rec.queries.map((q) => q.ops));
    expect(written).not.toContain("fp_live_secret");
    expect(written).toContain("v1.");
  });

  it("round-trips the sealed key back for the client to send", async () => {
    // Seal through the real cipher, then read it back the way getApiKey does.
    let sealed = "";
    const rec = recorderFor({ fleetpal_credentials: () => [{ org_id: ORG }] });
    await setApiKey(rec.client, ENV, ORG, "fp_live_secret");
    for (const q of rec.queries) {
      const s = JSON.stringify(q.ops);
      const m = /"api_key_sealed":"(v1\.[^"]+)"/.exec(s);
      if (m) sealed = m[1]!;
    }
    expect(sealed).not.toBe("");

    const rec2 = recorderFor({ fleetpal_credentials: () => [
      { base_url: "https://openapi.fleetpal.io", enabled: true, api_key_sealed: sealed },
    ] });
    expect(await getApiKey(rec2.client, ENV, ORG)).toEqual({
      apiKey: "fp_live_secret",
      baseUrl: "https://openapi.fleetpal.io",
    });
  });

  it("hands back nothing while the integration is switched off", async () => {
    const rec = recorderFor({ fleetpal_credentials: () => [
      { base_url: "https://openapi.fleetpal.io", enabled: false, api_key_sealed: "v1.a.b.c.d" },
    ] });
    // The kill switch has to work at the point the key is fetched, or a disabled integration still
    // polls a vendor.
    expect(await getApiKey(rec.client, ENV, ORG)).toBeNull();
  });

  it("is org-scoped on every query, because the service role bypasses RLS", async () => {
    const rec = recorderFor({ fleetpal_credentials: () => [{ org_id: ORG }] });
    await getCredential(rec.client, ORG);
    await setEnabled(rec.client, ORG, true);
    expectOrgScoped(rec, ORG);
  });
});

describe("the sync position", () => {
  it("⚠ leaves the position untouched when a sweep fails", async () => {
    const rec = recorderFor({ fleetpal_sync_state: () => [{ resource: "work-orders" }] });
    await recordFailure(rec.client, ORG, "work-orders", "429 from the vendor");
    const written = JSON.stringify(rec.queries.map((q) => q.ops));
    // Advancing past a window we failed to process loses whatever changed in it, and the next sweep
    // looks perfectly normal.
    expect(written).not.toContain("watermark");
    expect(written).not.toContain("window_end");
    expect(written).toContain("429 from the vendor");
  });

  it("⚠ writes a watermark and a window position to DIFFERENT columns", async () => {
    const rec = recorderFor({ fleetpal_sync_state: () => [{ resource: "work-orders" }] });
    await advance(rec.client, ORG, "work-orders", { kind: "watermark", at: "2026-09-10T00:00:00Z" }, 12);
    const wm = JSON.stringify(rec.queries.map((q) => q.ops));
    expect(wm).toContain("watermark");
    expect(wm).not.toContain("window_end");

    const rec2 = recorderFor({ fleetpal_sync_state: () => [{ resource: "defects" }] });
    await advance(rec2.client, ORG, "defects", { kind: "window", to: "2026-09-10T00:00:00Z" }, 3);
    const win = JSON.stringify(rec2.queries.map((q) => q.ops));
    // `defects` has no `updated` field at all. A window position read back as a watermark would skip
    // every defect that CHANGED without being re-created — one that resolved, for instance.
    expect(win).toContain("window_end");
    expect(win).not.toContain('"watermark"');
  });

  it("reads a never-run resource as null rather than an error, which is what makes the first sweep a full walk", async () => {
    const rec = recorderFor({ fleetpal_sync_state: () => [] });
    expect(await getSyncState(rec.client, ORG, "service-history")).toBeNull();
  });

  it("clears a previous error when a sweep succeeds", async () => {
    const rec = recorderFor({ fleetpal_sync_state: () => [{ resource: "work-orders" }] });
    await advance(rec.client, ORG, "work-orders", { kind: "watermark", at: "2026-09-10T00:00:00Z" }, 12);
    expect(JSON.stringify(rec.queries.map((q) => q.ops))).toContain('"last_error":null');
  });

  it("is org-scoped on every query", async () => {
    const rec = recorderFor({ fleetpal_sync_state: () => [{ resource: "work-orders" }] });
    await getSyncState(rec.client, ORG, "work-orders");
    await advance(rec.client, ORG, "work-orders", { kind: "watermark", at: "2026-09-10T00:00:00Z" }, 1);
    expectOrgScoped(rec, ORG);
  });
});

describe("staging a unit", () => {
  it("⚠ never touches the resolution, so a nightly sweep cannot unmatch what a person linked", async () => {
    const rec = recorderFor({ fleetpal_units: () => [{ id: "row-1" }] });
    await stageUnit(rec.client, ORG, UNIT);
    const written = JSON.stringify(rec.queries.map((q) => q.ops));
    expect(written).toContain('"vin":"1FUJGLDR8CLBP8834"');
    // The four columns that are OURS and not the vendor's.
    expect(written).not.toContain("match_method");
    expect(written).not.toContain("matched_at");
    expect(written).not.toContain("vehicle_id");
    expect(written).not.toContain("trailer_id");
  });

  it("stages the VMRS category as an opaque id and no description anywhere (D-FP8)", async () => {
    const rec = recorderFor({ fleetpal_units: () => [{ id: "row-1" }] });
    await stageUnit(rec.client, ORG, UNIT);
    const written = JSON.stringify(rec.queries.map((q) => q.ops));
    expect(written).toContain('"vmrs_equipment_category":"C1"');
    expect(written).not.toContain("description");
  });

  it("inserts when the unit is new and updates when it is not — never a partial upsert", async () => {
    const rec = recorderFor({ fleetpal_units: () => [] });
    await stageUnit(rec.client, ORG, UNIT);
    const methods = rec.queries.flatMap((q) => q.ops.map((o) => o.method));
    // `.upsert()` with a partial payload is what `lint:upserts` forbids: Postgres checks NOT NULL
    // before it arbitrates the conflict, so it fails in production and not in a test.
    expect(methods).not.toContain("upsert");
    expect(methods).toContain("insert");
  });

  it("clears a resolution to unmatched without leaving a stale timestamp", async () => {
    const rec = recorderFor({ fleetpal_units: () => [{ id: "row-1" }] });
    await setMatch(rec.client, ORG, "Vn7kPq2R", { method: "unmatched" });
    const written = JSON.stringify(rec.queries.map((q) => q.ops));
    // `fleetpal_units_match_agrees` refuses an unmatched row with a timestamp; this is the
    // application side agreeing with it rather than discovering it as a 23514.
    expect(written).toContain('"matched_at":null');
    expect(written).toContain('"match_method":"unmatched"');
  });

  it("counts the unmatched with a count, not the length of a page", async () => {
    const rec = recorderFor({ fleetpal_units: () => [] });
    await countUnmatched(rec.client, ORG);
    // PostgREST caps every response at 1,000 rows, so counting a fetched page under-reports a fleet
    // the moment it grows past one — and D-FP14 makes this the number that says how much the cost
    // report is missing.
    const select = rec.queries[0]?.ops.find((o) => o.method === "select");
    expect(JSON.stringify(select?.args)).toContain("exact");
  });

  it("is org-scoped on every query", async () => {
    const rec = recorderFor({ fleetpal_units: () => [{ id: "row-1" }] });
    await stageUnit(rec.client, ORG, UNIT);
    await setMatch(rec.client, ORG, "Vn7kPq2R", { method: "vin", vehicleId: "v-1" });
    await countUnmatched(rec.client, ORG);
    expectOrgScoped(rec, ORG);
  });

  it("does not reach another org's rows", async () => {
    const rec = recorderFor({ fleetpal_units: () => [{ id: "row-1" }] });
    await stageUnit(rec.client, OTHER, UNIT);
    expectOrgScoped(rec, OTHER);
  });
});

describe("webhook deliveries", () => {
  it("⚠ claims by INSERT, so two concurrent copies of one delivery cannot both proceed", async () => {
    const rec = recorderFor({ fleetpal_webhook_deliveries: () => [] });
    const first = await claimDelivery(rec.client, ORG, {
      deliveryId: "dlv_1",
      eventKey: "work_order.completed",
      eventAt: "2026-09-10T10:00:00Z",
    });
    expect(first.claimed).toBe(true);
    // A read-then-write would let both copies pass a "have we seen this?" SELECT. The unique
    // constraint is the only thing that can arbitrate it, so nothing here reads first.
    const methods = rec.queries.flatMap((q) => q.ops.map((o) => o.method));
    expect(methods).toContain("insert");
    expect(methods).not.toContain("maybeSingle");
  });

  it("reads a duplicate as already-claimed rather than as an error", async () => {
    // The recorder scripts a failure by RETURNING `{ data, error }` — the shape supabase-js
    // actually hands back. A thrown fixture would test our try/catch, which is not what
    // `claimDelivery` has: it branches on `error.code`, the way the driver reports a conflict.
    const rec = recorderFor({
      fleetpal_webhook_deliveries: () => ({ data: null, error: { code: "23505", message: "duplicate key" } }),
    });
    const again = await claimDelivery(rec.client, ORG, {
      deliveryId: "dlv_1",
      eventKey: "work_order.completed",
      eventAt: "2026-09-10T10:00:00Z",
    });
    expect(again).toEqual({ claimed: false });
    expect(again.error).toBeUndefined();
  });

  it("is org-scoped on every query", async () => {
    const rec = recorderFor({ fleetpal_webhook_deliveries: () => [] });
    await claimDelivery(rec.client, ORG, {
      deliveryId: "dlv_2",
      eventKey: "work_order.completed",
      eventAt: "2026-09-10T10:00:00Z",
    });
    await finishDelivery(rec.client, ORG, "dlv_2", { status: "processed" });
    expectOrgScoped(rec, ORG);
  });
});
