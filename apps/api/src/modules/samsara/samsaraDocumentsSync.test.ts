import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { documentWindows, syncSamsaraDocuments } from "./samsaraDocumentsSync.js";
import { NoSamsaraTokenError } from "./samsaraVehicleSync.js";

/**
 * The Samsara documents collector (DOCUMENT-READER-PLAN Step 0.1). What the parser does is tested in
 * `packages/shared`; what is tested here is the RUN:
 *
 * • every query is one org's — the service role bypasses RLS, so `.eq("org_id", …)` is the tenant wall;
 * • the watermark is the newest stored document, less the overlap, and the walk is oldest day first;
 * • a day is written before the next is asked for, so a failure cannot leave the watermark ahead of
 *   a day never stored;
 * • a refused item is counted, never written half-read.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ENV = { SAMSARA_API_URL: "https://api.samsara.test" } as unknown as Parameters<typeof syncSamsaraDocuments>[1];
const NOW = new Date("2026-10-08T12:00:00Z");

const doc = (id: string, updated: string) => ({
  id,
  createdAtTime: updated,
  updatedAtTime: updated,
  state: "submitted",
  documentType: { id: "t-bol", name: "BOL, SECURMENT, PLACARDS" },
  fields: [{ label: "Add Photos", type: "photo", value: { photoValue: [{ id: `${id}-p`, url: "https://s3.samsara.com/x" }] } }],
});

const seed = (watermark: string | null) =>
  createSupabaseRecorder({
    tables: { samsara_documents: watermark ? [{ samsara_updated_at: watermark }] : [] },
  });

describe("documentWindows", () => {
  it("cuts oldest-first day windows, the last one ending now", () => {
    const from = Date.parse("2026-10-06T06:00:00Z");
    expect(documentWindows(from, NOW.getTime())).toEqual([
      { startIso: "2026-10-06T06:00:00.000Z", endIso: "2026-10-07T06:00:00.000Z" },
      { startIso: "2026-10-07T06:00:00.000Z", endIso: "2026-10-08T06:00:00.000Z" },
      { startIso: "2026-10-08T06:00:00.000Z", endIso: "2026-10-08T12:00:00.000Z" },
    ]);
  });

  it("is empty when there is nothing between from and now", () => {
    expect(documentWindows(NOW.getTime(), NOW.getTime())).toEqual([]);
  });
});

describe("syncSamsaraDocuments", () => {
  it("scopes every query to one organization", async () => {
    const rec = seed("2026-10-08T10:00:00Z");
    await syncSamsaraDocuments(rec.client, ENV, ORG, {
      now: NOW,
      backfillDays: 7,
      fetcherOverride: async () => [doc("d1", "2026-10-08T11:00:00Z")],
    });
    expectOrgScoped(rec, ORG);
  });

  it("resumes from the newest stored document less the overlap", async () => {
    const rec = seed("2026-10-08T10:00:00Z");
    const asked: string[] = [];
    const r = await syncSamsaraDocuments(rec.client, ENV, ORG, {
      now: NOW,
      backfillDays: 7,
      fetcherOverride: async (w) => (asked.push(w.startIso), []),
    });
    // One hour behind the newest stored document — written out, not computed from the constant, so a
    // changed overlap fails here instead of agreeing with itself.
    const expected = "2026-10-08T09:00:00.000Z";
    expect(asked).toEqual([expected]);
    expect(r.from).toBe(expected);
  });

  it("reaches back the backfill horizon on an org's first run", async () => {
    const rec = seed(null);
    const asked: string[] = [];
    const r = await syncSamsaraDocuments(rec.client, ENV, ORG, {
      now: NOW,
      backfillDays: 3,
      fetcherOverride: async (w) => (asked.push(w.startIso), []),
    });
    expect(r.days).toBe(3);
    expect(asked[0]).toBe("2026-10-05T12:00:00.000Z");
  });

  it("does not skip a gap older than the backfill horizon", async () => {
    // The tier was off for a month. Resuming at the horizon would lose three weeks with no trace.
    const rec = seed("2026-09-08T12:00:00Z");
    const r = await syncSamsaraDocuments(rec.client, ENV, ORG, {
      now: NOW,
      backfillDays: 7,
      fetcherOverride: async () => [],
    });
    expect(r.days).toBe(31);
  });

  it("writes whole rows keyed for refresh in place, with photo ids and no vendor url", async () => {
    const rec = seed("2026-10-08T10:00:00Z");
    await syncSamsaraDocuments(rec.client, ENV, ORG, {
      now: NOW,
      backfillDays: 7,
      fetcherOverride: async () => [doc("d1", "2026-10-08T11:00:00Z")],
    });
    const [row] = rec.writtenRows("samsara_documents");
    expect(row).toMatchObject({
      org_id: ORG,
      samsara_document_id: "d1",
      document_type_name: "BOL, SECURMENT, PLACARDS",
      photo_ids: ["d1-p"],
      last_seen_at: NOW.toISOString(),
    });
    expect(JSON.stringify(row)).not.toContain("s3.samsara.com");
    const upsert = rec.writes().find((q) => q.table === "samsara_documents")!;
    expect(upsert.ops.find((o) => o.method === "upsert")!.args[1]).toEqual({ onConflict: "org_id,samsara_document_id" });
  });

  it("counts a malformed item instead of writing it", async () => {
    const rec = seed("2026-10-08T10:00:00Z");
    const r = await syncSamsaraDocuments(rec.client, ENV, ORG, {
      now: NOW,
      backfillDays: 7,
      fetcherOverride: async () => [doc("d1", "2026-10-08T11:00:00Z"), { id: "", fields: [] }],
    });
    expect(r).toMatchObject({ fetched: 2, written: 1, refused: 1 });
  });

  it("writes each day before asking for the next, so a failure leaves the watermark behind it", async () => {
    const rec = seed("2026-10-06T12:00:00Z");
    let calls = 0;
    await expect(
      syncSamsaraDocuments(rec.client, ENV, ORG, {
        now: NOW,
        backfillDays: 7,
        fetcherOverride: async (w) => {
          calls += 1;
          if (calls === 2) throw new Error("Samsara documents API 503");
          return [doc(`d${calls}`, w.startIso)];
        },
      }),
    ).rejects.toThrow("503");
    expect(rec.writtenRows("samsara_documents").map((r) => r.samsara_document_id)).toEqual(["d1"]);
  });

  it("refuses to run without a token", async () => {
    const rec = createSupabaseRecorder({ tables: { integration_credentials: [], samsara_documents: [] } });
    await expect(
      syncSamsaraDocuments(rec.client, { ...ENV, SAMSARA_API_TOKEN: undefined } as typeof ENV, ORG, {
        now: NOW,
        backfillDays: 7,
      }),
    ).rejects.toBeInstanceOf(NoSamsaraTokenError);
  });
});
