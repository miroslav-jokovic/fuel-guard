import { beforeEach, describe, expect, it, vi } from "vitest";
import { shopAnnualDueToQuery } from "@silvicom/shared";

/** The tool's answer is `unknown` to its caller (it goes to the model as JSON); tests read named fields. */
type Out = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Ask AI's `annual_inspections_due` (F21 R6b). Its header promises the Shop worklist's own reader,
 * split by its own `daysRemaining`, in its own order, and the gaps said out loud. So `readAnnualDue`
 * is a spy whose order is not by unit number.
 */
const readAnnualDue = vi.fn();
vi.mock("./inspections/annualDue.js", () => ({ readAnnualDue: (...a: unknown[]) => readAnnualDue(...a) }));
const { assistantAnnualDue, ANNUAL_DUE_SOURCE } = await import("./assistantAnnualDue.js");

const ORG = "org-1";
const NOW = new Date("2026-11-10T15:00:00Z");
const ROWS = [
  { subjectType: "trailer", unitId: "t1", unitNumber: "5301", expiresOn: "2026-10-30", daysRemaining: -11 },
  { subjectType: "tractor", unitId: "v1", unitNumber: "819", expiresOn: "2026-11-10", daysRemaining: 0 },
  { subjectType: "tractor", unitId: "v2", unitNumber: "748", expiresOn: "2026-12-01", daysRemaining: 21 },
];

beforeEach(() => {
  readAnnualDue.mockReset();
  readAnnualDue.mockResolvedValue(ROWS);
});

describe("annual_inspections_due — the Shop worklist's annual group", () => {
  it("reads the worklist's reader for this org and clock, and splits by its own days remaining", async () => {
    const admin = {} as never;
    const out = (await assistantAnnualDue(admin, ORG, {}, NOW)) as Out;
    expect(readAnnualDue).toHaveBeenCalledWith(admin, ORG, NOW);
    expect(out).toMatchObject({ source: ANNUAL_DUE_SOURCE, warning_window_days: 30, overdue_count: 1, due_soon_count: 2 });
    expect(out.units).toEqual([
      { unit: "5301", kind: "trailer", expires_on: "2026-10-30", days_remaining: -11 },
      { unit: "819", kind: "truck", expires_on: "2026-11-10", days_remaining: 0 },
      { unit: "748", kind: "truck", expires_on: "2026-12-01", days_remaining: 21 },
    ]);
    expect(out.not_included).toMatch(/no recorded annual inspection/);
  });

  it("kind narrows to trucks or trailers", async () => {
    const out = (await assistantAnnualDue({} as never, ORG, { kind: "trailer" }, NOW)) as Out;
    expect(out.units.map((u: Out) => u.unit)).toEqual(["5301"]);
    expect(out).toMatchObject({ overdue_count: 1, due_soon_count: 0 });
  });

  it("links the Shop's Annual due tab on the asked kind, in the page's word, built by its contract", async () => {
    const trucks = (await assistantAnnualDue({} as never, ORG, { kind: "truck" }, NOW)) as Out;
    expect(trucks.link).toEqual({ surfaceKey: "maintenance.repair-spend", query: { tab: "annual", kind: "tractor" } });
    const all = (await assistantAnnualDue({} as never, ORG, {}, NOW)) as Out;
    expect(all.link.query).toEqual(shopAnnualDueToQuery({}));
    expect(all.link.query).toEqual({ tab: "annual" });
  });

  it("a failed read is an error, never an empty yard", async () => {
    readAnnualDue.mockResolvedValue({ error: { message: "db down" } });
    await expect(assistantAnnualDue({} as never, ORG, {}, NOW)).rejects.toThrow("db down");
  });
});
