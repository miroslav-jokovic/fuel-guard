import { describe, it, expect } from "vitest";
import { loadScreeningReadiness } from "./screeningReadiness.js";
import { createSupabaseRecorder, expectOrgScoped } from "../testing/supabaseRecorder.js";
import { loadEnv } from "../env.js";

/**
 * The report that would have said, on 2026-08-20, "0 of 201 drivers can be screened — 201 need a
 * date of birth". Its value is entirely in being true, so what is pinned here is that it counts the
 * right people and asks the real validator.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const TODAY = "2026-08-20";
const env = (over: Record<string, string> = {}) =>
  // PRODUCTION by default here on purpose. Readiness asks whether the REAL carrier can screen a
  // real driver, and since 0217-era identity became environment-aware the org's DOT number is only
  // consulted for the production account — in UAT it belongs to a carrier that does not exist.
  loadEnv({ NODE_ENV: "test", PSP_ENVIRONMENT: "production", ...over } as NodeJS.ProcessEnv);

const driver = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  first_name: "Susan",
  last_name: "Godfrey",
  full_name: "Susan Godfrey",
  status: "active",
  date_of_birth: "1949-12-11",
  cdl_number: "PA334554",
  cdl_state: "PA",
  ...over,
});

const seed = (drivers: unknown[], dotNumber: string | null = "1864495") =>
  createSupabaseRecorder({
    tables: {
      drivers,
      organizations: [{ id: ORG, dot_number: dotNumber }],
    },
  });

describe("screening readiness", () => {
  it("counts a fully identified driver as ready", async () => {
    const rec = seed([driver()]);
    const out = await loadScreeningReadiness(rec.client, env(), ORG, TODAY);
    expect(out.summary).toMatchObject({ drivers: 1, ready: 1, carrierSource: "organization" });
  });

  /** The production shape: everything but the one field nobody has ever entered. */
  it("names the date of birth as the blocker, and counts how many it blocks", async () => {
    const rec = seed([driver({ date_of_birth: null }), driver({ id: "d2", date_of_birth: null })]);
    const out = await loadScreeningReadiness(rec.client, env(), ORG, TODAY);
    expect(out.summary.ready).toBe(0);
    expect(out.summary.blockedBy).toEqual([{ field: "driverDOB", drivers: 2 }]);
    expect(out.rows[0]!.gaps[0]!.message).toMatch(/date of birth/i);
  });

  /**
   * Only the people who would actually be screened. Counting terminated drivers would make the
   * number that matters — how much data entry stands between here and a usable integration —
   * permanently worse for no reason.
   */
  it("asks the database for active and applicant drivers only", async () => {
    const rec = seed([driver()]);
    await loadScreeningReadiness(rec.client, env(), ORG, TODAY);
    const statuses = rec.forTable("drivers")[0]!.ops.find((o) => o.method === "in");
    expect(statuses?.args).toEqual(["status", ["active", "applicant"]]);
  });

  it("uses the organisation's DOT number over the deployment's, in production", async () => {
    const rec = seed([driver()], "1864495");
    const out = await loadScreeningReadiness(rec.client, env({ PSP_DOT_NUMBER: "43586" }), ORG, TODAY);
    expect(out.summary.carrierSource).toBe("organization");
  });

  it("falls back to the deployment's when the organisation has none", async () => {
    const rec = seed([driver()], null);
    const out = await loadScreeningReadiness(rec.client, env({ PSP_DOT_NUMBER: "43586" }), ORG, TODAY);
    expect(out.summary.carrierSource).toBe("environment");
    expect(out.summary.ready).toBe(1);
  });

  /** No carrier number anywhere blocks every driver, whatever else is filled in (§8.5 detail 10). */
  it("reports the carrier itself as the blocker when nobody has one", async () => {
    const rec = seed([driver()], null);
    const out = await loadScreeningReadiness(rec.client, env(), ORG, TODAY);
    expect(out.summary.ready).toBe(0);
    expect(out.summary.blockedBy).toEqual([{ field: "dotNumber", drivers: 1 }]);
    expect(out.summary.carrierSource).toBe("none");
  });

  it("scopes every read to the caller's org", async () => {
    const rec = seed([driver()]);
    await loadScreeningReadiness(rec.client, env(), ORG, TODAY);
    expectOrgScoped(rec, ORG, {
      // Filtered by primary key, which IS the tenant id — the table that owns the concept has no
      // `org_id` column of its own.
      exempt: ["organizations"],
    });
  });
});
