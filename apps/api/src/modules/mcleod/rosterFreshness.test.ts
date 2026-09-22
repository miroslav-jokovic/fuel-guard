import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { readRosterFreshness } from "./rosterFreshness.js";
import { stampRosterRead, ROSTER_PROVIDER } from "./tmsIngest.js";

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const COUNTS = { drivers: 165, vehicles: 193, trailers: 223 };

const provider = (q: RecordedQuery) => q.filters().find((f) => f.col === "provider")?.val;

/** `org_integrations` answering per provider, so a read of the wrong row cannot pass by accident. */
const seed = (rows: Record<string, Record<string, unknown> | null>) =>
  createSupabaseRecorder({
    tables: {
      org_integrations: (q) => {
        const row = rows[String(provider(q))] ?? null;
        if (q.write?.method === "update") return { data: row ? [{ org_id: ORG }] : [] };
        return { data: row };
      },
    },
  });

describe("stampRosterRead", () => {
  it("stamps the roster's OWN row, never the shared `mcleod` one", async () => {
    // `mcleod.last_synced_at` is touched by movements and loads too; on 2026-09-22 it read 09-17
    // while the roster had last been swept on 09-14.
    const rec = seed({ [ROSTER_PROVIDER]: { last_synced_at: "2026-09-22T19:00:00Z" } });
    await stampRosterRead(rec.client, ORG, COUNTS);
    const writes = rec.writes();
    expect(writes).toHaveLength(1);
    expect(provider(writes[0]!)).toBe(ROSTER_PROVIDER);
    expect(writes[0]!.write?.payload).toMatchObject({ config: { counts: COUNTS } });
    expectOrgScoped(rec, ORG);
  });

  it("creates the row with a FULL insert the first time, never a partial upsert", async () => {
    const rec = seed({});
    await stampRosterRead(rec.client, ORG, COUNTS);
    const insert = rec.writes().find((q) => q.write?.method === "insert");
    expect(insert?.write?.payload).toMatchObject({
      org_id: ORG, provider: ROSTER_PROVIDER, enabled: true, config: { counts: COUNTS },
    });
    expect(rec.writes().some((q) => q.write?.method === "upsert")).toBe(false);
  });
});

describe("readRosterFreshness", () => {
  it("returns when McLeod was last read and what the read saw", async () => {
    const rec = seed({
      [ROSTER_PROVIDER]: { last_synced_at: "2026-09-22T19:00:00Z", config: { counts: COUNTS } },
      mcleod: { enabled: true },
    });
    expect(await readRosterFreshness(rec.client, ORG)).toEqual({
      configured: true, readAt: "2026-09-22T19:00:00Z", counts: COUNTS,
    });
    expectOrgScoped(rec, ORG);
  });

  it("says NEVER for a McLeod carrier whose roster has not been read — it does not hide", async () => {
    const rec = seed({ mcleod: { enabled: true } });
    expect(await readRosterFreshness(rec.client, ORG)).toEqual({ configured: true, readAt: null, counts: null });
  });

  it("is unconfigured for a carrier with no McLeod at all, so the surface says nothing", async () => {
    const rec = seed({});
    expect((await readRosterFreshness(rec.client, ORG)).configured).toBe(false);
  });
});
