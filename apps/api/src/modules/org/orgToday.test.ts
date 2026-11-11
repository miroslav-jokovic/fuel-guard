import { describe, expect, it } from "vitest";
import { orgToday } from "./orgToday.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";

/**
 * The carrier's calendar day (F21 carrier-day fix, 2026-11-11). 01:30 UTC on 11/11 is 7:30 pm on 11/10
 * in Chicago and 5:30 pm in Los Angeles: the UTC cut (`toISOString().slice(0, 10)`) says 11/11 for both,
 * which is the bug every reader that moved to this function had.
 */
const ORG = "org-1";
const NOV_10_EVENING_CT = new Date("2026-11-11T01:30:00Z");
const org = (operating_hours: unknown) => createSupabaseRecorder({ tables: { organizations: [{ id: ORG, operating_hours }] } });

describe("orgToday — the carrier's calendar day", () => {
  it("is 11/10 on a Central evening when UTC has already turned to 11/11", async () => {
    const rec = org({ tz: "America/Chicago" });
    expect(await orgToday(rec.client as never, ORG, NOV_10_EVENING_CT)).toBe("2026-11-10");
    expectOrgScoped(rec, ORG);
  });

  it("reads the org's own zone, not a fixed one", async () => {
    expect(await orgToday(org({ tz: "America/Los_Angeles" }).client as never, ORG, NOV_10_EVENING_CT)).toBe("2026-11-10");
    expect(await orgToday(org({ tz: "Europe/Berlin" }).client as never, ORG, NOV_10_EVENING_CT)).toBe("2026-11-11");
  });

  it("falls back to the default carrier zone (Central) when the org names none", async () => {
    expect(await orgToday(org(null).client as never, ORG, NOV_10_EVENING_CT)).toBe("2026-11-10");
  });

  it("agrees with the UTC day at midday, so only the evening hours move", async () => {
    expect(await orgToday(org({ tz: "America/Chicago" }).client as never, ORG, new Date("2026-11-10T18:00:00Z"))).toBe("2026-11-10");
  });
});

/**
 * The sites the 2026-11-11 fix moved, by file. Each is a one-line call to `orgToday` whose behaviour is
 * pinned above and in `annualCarrierDay.test.ts`, `dqAlertScheduler.test.ts` and
 * `assistantDriverFiles.test.ts`; this keeps the UTC cut from coming back to any of them unnoticed.
 */
describe("the carrier-day sites keep no UTC-day cut", () => {
  const SITES = [
    "../evidence/routes/compliance.ts",
    "../evidence/dqAlertScheduler.ts",
    "../evidence/routes/complianceExports.ts",
    "../evidence/assistantDriverFiles.ts",
    "./digest.ts",
    "../maintenance/inspections/annualDue.ts",
    "../maintenance/inspections/annualDisagreements.ts",
    "../maintenance/inspections/inspections.ts",
    "../maintenance/inspections/inspectors.ts",
    "../maintenance/routes/inspectors.ts",
    "../livemap/dispatchBoard.ts",
  ];
  it.each(SITES)("%s", async (rel) => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL(rel, import.meta.url), "utf8");
    // Code only: the comments in these files quote the old cut on purpose, to say why it went.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/toISOString\(\)\.slice\(0, 10\)/);
  });
});
