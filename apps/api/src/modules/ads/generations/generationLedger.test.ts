import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { anthropicTokensThisMonth, TOKEN_FOLD_PAGE } from "./generationLedger.js";

const ORG = "org-a";

describe("anthropicTokensThisMonth", () => {
  it("folds the month's tokens across every page, not only the first thousand rows", async () => {
    const page = (n: number, start: number) => Array.from({ length: n }, (_, i) => ({ id: `g${String(start + i).padStart(5, "0")}`, cost_units: "10.0000" }));
    const rec = createSupabaseRecorder({
      tables: { ad_generations: { pages: [page(TOKEN_FOLD_PAGE, 0), page(TOKEN_FOLD_PAGE, TOKEN_FOLD_PAGE), page(3, 2 * TOKEN_FOLD_PAGE)] } },
    });
    expect(await anthropicTokensThisMonth(rec.client, ORG, new Date("2026-11-15T18:00:00Z"))).toBe((2 * TOKEN_FOLD_PAGE + 3) * 10);
    const reads = rec.forTable("ad_generations");
    expect(reads).toHaveLength(3);
    // Keyset: the second page starts after the first page's last id.
    expect(reads[1]!.ops).toContainEqual({ method: "gt", args: ["id", `g${String(TOKEN_FOLD_PAGE - 1).padStart(5, "0")}`] });
    expectOrgScoped(rec, ORG);
  });

  it("reads the carrier's month in Central time, Anthropic tokens only", async () => {
    const rec = createSupabaseRecorder({ tables: { ad_generations: [] } });
    // 03:00 UTC on Nov 1 is still Oct 31 in Chicago, so the October budget is the one being spent.
    await anthropicTokensThisMonth(rec.client, ORG, new Date("2026-11-01T03:00:00Z"));
    const ops = rec.forTable("ad_generations")[0]!.ops;
    expect(ops).toContainEqual({ method: "gte", args: ["started_at", "2026-10-01T05:00:00.000Z"] });
    expect(ops).toContainEqual({ method: "lt", args: ["started_at", "2026-11-01T05:00:00.000Z"] });
    expect(ops).toContainEqual({ method: "eq", args: ["provider", "anthropic"] });
    expect(ops).toContainEqual({ method: "eq", args: ["cost_unit", "tokens"] });
  });
});
