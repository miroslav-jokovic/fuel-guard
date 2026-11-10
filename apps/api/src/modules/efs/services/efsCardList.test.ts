import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { listEfsCards } from "./efsCardList.js";

/**
 * The Fuel Cards page's list read, moved out of `routes/read.ts` (F21 R6b) so Ask AI's `card_holds`
 * asks the same question. Pinned here: org scope, the case-blind status match the account needs
 * (it stores `HOLD`), the masking path, and the total from the count rather than the rows returned.
 */
const ROW = {
  id: "c1", card_last4: "7468", status: "HOLD", policy_number: 1, driver_id_prompt: null, unit_prompt: "819", driver_name: "HECTOR",
  override_uses: null, override_all_locations: null, location_override_id: null, last_used_date: null, fuel_card_id: null,
  fuel_card_link: null, synced_at: "2026-11-10T19:55:00Z", detail_synced_at: null, absent_since: null, sync_error: null,
};

describe("listEfsCards — the Fuel Cards page's list read", () => {
  it("is org-scoped, matches a status case-blind, and masks every card", async () => {
    const rec = createSupabaseRecorder({ tables: { efs_cards: { data: [ROW], count: 240 } } });
    const out = await listEfsCards(rec.client, "org-1", { status: "Hold" });
    expectOrgScoped(rec, "org-1");
    expect(rec.forTable("efs_cards")[0]!.ops).toContainEqual({ method: "ilike", args: ["status", "Hold"] });
    expect(out).toMatchObject({ ok: true, total: 240, cards: [{ id: "c1", last4: "7468", maskedRef: "•••• 7468", status: "HOLD", unitPrompt: "819" }] });
  });

  it("answers the database's error rather than an empty list", async () => {
    const rec = createSupabaseRecorder({ tables: { efs_cards: { error: { message: "boom" } } } });
    const out = await listEfsCards(rec.client, "org-1");
    expect(out).toEqual({ ok: false, error: expect.objectContaining({ message: "boom" }) });
  });
});
