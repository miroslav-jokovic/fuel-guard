import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { stampFinancialSynced, readFinancialSyncedAt, FINANCIAL_PROVIDER } from "./tmsIngest.js";

/**
 * D-FIN3: the financial sweep stamps its OWN provider row. Update when it exists, a FULL insert
 * when it does not (never a partial upsert — lint:upserts), and every query carries the org.
 */
const ORG = "11111111-1111-1111-1111-111111111111";

describe("stampFinancialSynced", () => {
  it("updates the mcleod_financial row when it exists, and inserts nothing", async () => {
    const rec = createSupabaseRecorder({ tables: { org_integrations: [{ org_id: ORG }] } });
    await stampFinancialSynced(rec.client, ORG);
    const writes = rec.queries.filter((q) => q.table === "org_integrations" && q.write);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.ops.some((o) => o.method === "update")).toBe(true);
    expect(writes[0]!.ops.filter((o) => o.method === "eq").map((o) => o.args)).toEqual([
      ["org_id", ORG],
      ["provider", FINANCIAL_PROVIDER],
    ]);
    expectOrgScoped(rec, ORG);
  });

  it("inserts the whole row on the first stamp — provider, enabled, config and the stamp", async () => {
    const rec = createSupabaseRecorder({ tables: { org_integrations: [] } });
    await stampFinancialSynced(rec.client, ORG);
    const inserted = rec.queries.filter((q) => q.table === "org_integrations" && q.ops.some((o) => o.method === "insert"));
    expect(inserted).toHaveLength(1);
    const row = rec.writtenRows("org_integrations").find((r) => r.provider === FINANCIAL_PROVIDER)!;
    expect(row).toMatchObject({ org_id: ORG, provider: "mcleod_financial", enabled: true, config: {} });
    expect(typeof row.last_synced_at).toBe("string");
    expectOrgScoped(rec, ORG);
  });
});

describe("readFinancialSyncedAt", () => {
  it("returns the stamp, or null when the sweep has never landed", async () => {
    const stamped = createSupabaseRecorder({ tables: { org_integrations: [{ last_synced_at: "2026-08-28T21:02:00.000Z" }] } });
    expect(await readFinancialSyncedAt(stamped.client, ORG)).toBe("2026-08-28T21:02:00.000Z");
    const never = createSupabaseRecorder({ tables: { org_integrations: [] } });
    expect(await readFinancialSyncedAt(never.client, ORG)).toBeNull();
    expectOrgScoped(never, ORG);
  });
});
