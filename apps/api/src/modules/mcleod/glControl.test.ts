import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { ingestGlControl, readLedgerClose } from "./glControl.js";

/**
 * McLeod's open accounting period (0502, D-TP5): the landing and the close verdict read from it.
 * The fixture is the sandbox as read 2026-10-19 — TMS, fiscal 2026 period 8, `prior_post = 'N'`.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const TMS = {
  company_id: "TMS", fiscal_year: "2026", fiscal_period: 8, prior_post_allowed: false,
  period_start: "2026-08-01", period_end: "2026-09-01",
};

describe("ingestGlControl", () => {
  it("replaces the company's row whole on (org_id, company_id), scoped to the org", async () => {
    const rec = createSupabaseRecorder({ tables: { mcleod_gl_control: [] } });
    const r = await ingestGlControl(rec.client as unknown as SupabaseClient, ORG, { control: TMS });
    expect(r.received).toBe(1);
    const [row] = rec.writtenRows("mcleod_gl_control");
    expect(row).toMatchObject({ org_id: ORG, ...TMS });
    expect(typeof row!.swept_at).toBe("string");
    const write = rec.queries.find((q) => q.write?.method === "upsert")!;
    expect(write.ops.find((o) => o.method === "upsert")?.args[1]).toMatchObject({ onConflict: "org_id,company_id" });
    expectOrgScoped(rec, ORG);
  });
});

describe("readLedgerClose", () => {
  const stored = (rows: unknown[]) => createSupabaseRecorder({ tables: { mcleod_gl_control: rows } });
  const row = (over: Record<string, unknown> = {}) => ({
    company_id: "TMS", period_start: "2026-08-01", prior_post_allowed: false, swept_at: "2026-10-09T18:59:20Z", ...over,
  });

  it("names the open period as a month, org-scoped", async () => {
    const rec = stored([row()]);
    expect(await readLedgerClose(rec.client as unknown as SupabaseClient, ORG)).toEqual({
      openMonth: "2026-08",
      sweptAt: "2026-10-09T18:59:20Z",
    });
    expectOrgScoped(rec, ORG);
  });

  it("knows nothing when no sweep has staged a control row", async () => {
    expect(await readLedgerClose(stored([]).client as unknown as SupabaseClient, ORG)).toBeNull();
  });

  it("makes no month final when a company allows posting into earlier periods", async () => {
    const rec = stored([row(), row({ company_id: "TMS3", period_start: "2017-12-01", prior_post_allowed: true })]);
    expect(await readLedgerClose(rec.client as unknown as SupabaseClient, ORG)).toBeNull();
  });

  it("takes the earliest open period across companies — a fleet month is final only when every company's is", async () => {
    const rec = stored([row(), row({ company_id: "TMS2", period_start: "2026-07-01" })]);
    expect((await readLedgerClose(rec.client as unknown as SupabaseClient, ORG))?.openMonth).toBe("2026-07");
  });
});
