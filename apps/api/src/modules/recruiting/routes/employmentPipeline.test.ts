import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { readApplicantPipeline } from "./employmentPipeline.js";

/**
 * `readApplicantPipeline`, moved out of `GET /pipeline`'s handler (F21 R6b) so Ask AI's
 * `recruiting_counts` reads the same rows. Pinned here because the route tests only see a 200: which
 * half of the board it reads (`archived`), that a failed read is a failure rather than an empty
 * board, and that it is org-scoped.
 */
describe("readApplicantPipeline — the Applicants board's read", () => {
  it("reads the unarchived half by default and the archived half when asked, for this org", async () => {
    const rec = createSupabaseRecorder({ tables: { drivers: [] } });
    expect(await readApplicantPipeline(rec.client, "org-1")).toEqual({ ok: true, applicants: [] });
    await readApplicantPipeline(rec.client, "org-1", { archived: true });
    const [live, archived] = rec.forTable("drivers");
    expect(live!.ops).toContainEqual({ method: "filter", args: ["archived_at", "is", null] });
    expect(archived!.ops).toContainEqual({ method: "filter", args: ["archived_at", "not.is", null] });
    expectOrgScoped(rec, "org-1");
  });

  it("answers a failed read with the board's own message, never an empty board", async () => {
    const rec = createSupabaseRecorder({ tables: { drivers: { error: { message: "boom" } } } });
    expect(await readApplicantPipeline(rec.client, "org-1")).toEqual({ ok: false, message: "Could not list applicants" });
  });
});
