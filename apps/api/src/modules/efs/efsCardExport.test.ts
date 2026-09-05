import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { exportCards } from "./efsCardExport.js";

/**
 * The card inventory as a file (FUEL-P2, D-FUI15).
 *
 * The seven facets are `matchesCardFilters` in `@silvicom/shared`, tested there against the page's own
 * meaning of each. What is only testable here is the seam: that this export reads the same rows the
 * list route reads, scopes them to the caller's org, applies that shared predicate rather than a
 * second SQL statement of it, and never puts a card number in a file.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const SCOPE = { title: "Fuel cards", from: null, to: null, trucks: 0, generatedAt: "2026-09-04T12:00:00.000Z" };

const row = (over: Record<string, unknown> = {}) => ({
  id: "c1", card_last4: "1234", status: "ACTIVE", policy_number: 12, driver_id_prompt: "D-9",
  unit_prompt: "654", driver_name: "A Driver", override_uses: null, override_all_locations: null,
  location_override_id: null, last_used_date: "2026-08-30", fuel_card_id: null, fuel_card_link: null,
  synced_at: "2026-09-04T00:00:00Z", detail_synced_at: null, absent_since: null, sync_error: null,
  ...over,
});

const seed = (cards: unknown[]) => createSupabaseRecorder({ tables: { efs_cards: cards, audit_logs: [] } });

describe("the card export reads what the list reads, scoped to the caller", () => {
  it("scopes to the org, because the service role bypasses RLS", async () => {
    const rec = seed([row()]);
    await exportCards(rec.client, { orgId: ORG, status: null, search: null, filters: {}, scope: SCOPE });
    expectOrgScoped(rec, ORG);
  });

  it("applies status with ilike, because the account stores ACTIVE and the menu says Active", async () => {
    const rec = seed([row()]);
    await exportCards(rec.client, { orgId: ORG, status: "Active", search: null, filters: {}, scope: SCOPE });
    expect(rec.forTable("efs_cards")[0]!.ops.filter((o) => o.method === "ilike").map((o) => o.args)).toEqual([
      ["status", "Active"],
    ]);
  });

  /**
   * ⚠ `card_last4` is not unique — two cards can end in the same four digits — so ordering by it alone
   * is not a total order, and a page boundary between two such cards can repeat one and drop the
   * other. Every export in this section orders by `id` last for that reason.
   */
  it("orders every page by a unique key", async () => {
    const rec = seed([row()]);
    await exportCards(rec.client, { orgId: ORG, status: null, search: null, filters: {}, scope: SCOPE });
    expect(rec.forTable("efs_cards")[0]!.ops.filter((o) => o.method === "order").map((o) => o.args[0])).toEqual([
      "card_last4",
      "id",
    ]);
  });

  it("narrows by the page's in-memory facets rather than a second statement of them in SQL", async () => {
    const rec = seed([
      row({ id: "c1", card_last4: "1111", override_uses: 2 }),
      row({ id: "c2", card_last4: "2222", override_uses: null }),
    ]);
    const out = await exportCards(rec.client, {
      orgId: ORG, status: null, search: null, filters: { override: "active" }, scope: SCOPE,
    });
    expect(out.rows).toBe(1);
    expect(out.csv).toContain("1111");
    expect(out.csv).not.toContain("2222");
    // …and the narrowing happened in TypeScript, so nothing extra was asked of the database.
    expect(rec.forTable("efs_cards")[0]!.filters().map((f) => f.col)).toEqual(["org_id"]);
  });

  it("never writes a card number — the masked ref and the last four, exactly as the screen", async () => {
    const rec = seed([row()]);
    const out = await exportCards(rec.client, { orgId: ORG, status: null, search: null, filters: {}, scope: SCOPE });
    expect(out.csv).toContain("1234");
    expect(out.csv).not.toContain("card_number");
    // The select list is the LIST columns, which do not include the sealed number.
    expect(String(rec.forTable("efs_cards")[0]!.ops[0]!.args[0])).not.toContain("card_number_sealed");
  });

  it("says what an exception covers, because 'two uses' and 'two uses at one stop' are different", async () => {
    const rec = seed([row({ override_uses: 2, override_all_locations: true })]);
    expect((await exportCards(rec.client, { orgId: ORG, status: null, search: null, filters: {}, scope: SCOPE })).csv)
      .toContain("Any location");

    const rec2 = seed([row({ override_uses: 2, override_all_locations: false, location_override_id: "LOC-9" })]);
    expect((await exportCards(rec2.client, { orgId: ORG, status: null, search: null, filters: {}, scope: SCOPE })).csv)
      .toContain("One location (LOC-9)");
  });

  it("leaves the exception column empty for a card that has none, rather than writing a scope for nothing", async () => {
    const rec = seed([row()]);
    const out = await exportCards(rec.client, { orgId: ORG, status: null, search: null, filters: {}, scope: SCOPE });
    expect(out.csv).not.toContain("Any location");
    expect(out.csv).not.toContain("Unknown");
  });

  it("prints what the file covers on the file", async () => {
    const rec = seed([row()]);
    const out = await exportCards(rec.client, { orgId: ORG, status: null, search: null, filters: {}, scope: SCOPE });
    expect(out.csv.split("\r\n")[0]).toBe(
      "# Fuel cards · all dates · all trucks · 1 rows · generated 2026-09-04T12:00:00.000Z",
    );
  });
});
