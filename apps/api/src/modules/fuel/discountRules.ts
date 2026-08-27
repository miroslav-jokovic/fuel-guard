import type { SupabaseClient } from "@supabase/supabase-js";
import type { DiscountRuleRow } from "@silvicom/shared";

/**
 * Replace the org's per-brand discount rules: upsert what the admin kept, delete what they
 * removed — the same replace-set semantics the browser performed directly until P6.1, now
 * through the owner where they can be validated, gated and audited. The schema lowercases and
 * trims brands, so the delete's keep-list compares like with like.
 */
export async function replaceDiscountRules(
  admin: SupabaseClient,
  orgId: string,
  rules: DiscountRuleRow[],
): Promise<{ upserted: number; removed: boolean }> {
  const rows = rules.map((r) => ({
    org_id: orgId,
    brand: r.brand,
    type: r.type,
    cents_off: r.cents_off,
    updated_at: new Date().toISOString(),
  }));
  if (rows.length) {
    const { error } = await admin.from("fuel_discount_rules").upsert(rows, { onConflict: "org_id,brand" });
    if (error) throw new Error(`fuel_discount_rules upsert failed: ${error.message}`);
  }
  let del = admin.from("fuel_discount_rules").delete().eq("org_id", orgId);
  const keep = rules.map((r) => r.brand);
  if (keep.length) del = del.not("brand", "in", `(${keep.join(",")})`);
  const { error: delErr } = await del;
  if (delErr) throw new Error(`fuel_discount_rules delete failed: ${delErr.message}`);
  return { upserted: rows.length, removed: true };
}
