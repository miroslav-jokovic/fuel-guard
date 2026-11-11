import { beforeEach, describe, expect, it, vi } from "vitest";
import { driversToQuery } from "@silvicom/shared";

/** The tool's answer is `unknown` to its caller (it goes to the model as JSON); tests read named fields. */
type Out = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Ask AI's `driver_file_expirations` (F21 R6b). Its header promises the route's own read with the
 * route's `today`, the DEFAULT horizon (no `expiringWithinDays`), and no Med-Stop violations or papers
 * (D-AI7). So `getComplianceOverview` is a spy, and its fixture's attention order is deliberately not
 * alphabetical: a tool that re-sorted or re-judged a date would change it.
 */
const getComplianceOverview = vi.fn();
vi.mock("./complianceOverview.js", () => ({ getComplianceOverview: (...a: unknown[]) => getComplianceOverview(...a) }));
const { assistantDriverFiles, DRIVER_FILES_SOURCE } = await import("./assistantDriverFiles.js");
const { createSupabaseRecorder, expectOrgScoped } = await import("../../testing/supabaseRecorder.js");

const ORG = "org-1";
// 7:30 pm Central on 11/10 — already 11/11 in UTC. The org's zone is read from its own row (`orgToday`).
const NOV_10_EVENING_CT = new Date("2026-11-11T01:30:00Z");
const central = () => createSupabaseRecorder({ tables: { organizations: [{ id: ORG, operating_hours: { tz: "America/Chicago" } }] } });
const db = () => central().client as never;
const att = (label: string, state: string, goodUntil: string | null, daysRemaining: number | null) =>
  ({ key: label.toLowerCase(), label, citation: "§391", group: "medical", state, goodUntil, evidenceDate: null, daysRemaining });
const driver = (name: string, state: string, attention: unknown[]) =>
  ({ driver_id: name, driver_name: name, driver_status: "active", state, counts: {}, groups: [], attention, requirements: [], documents: { onFile: 0, of: 0 } });

const OVERVIEW = {
  includesHazmat: false,
  truncated: false,
  drivers: [
    driver("ANA LOPEZ", "incomplete", [att("Medical card", "expiring", "2026-11-20", 9)]),
    driver("BEN CRUZ", "incomplete", [att("CDL", "expired", "2026-10-01", -41), att("Annual MVR review", "missing", null, null)]),
    driver("CAL DIAZ", "complete", []),
    driver("DEE PARK", "not_started", [att("Employment application", "missing", null, null)]),
  ],
};

beforeEach(() => {
  getComplianceOverview.mockReset();
  getComplianceOverview.mockResolvedValue(OVERVIEW);
});

describe("driver_file_expirations — the Drivers page's qualification files", () => {
  it("asks the route's read on the carrier's day (11/10 on a Central evening, not UTC's 11/11), the default horizon, and no testing records or papers", async () => {
    const rec = central();
    const admin = rec.client as never;
    await assistantDriverFiles(admin, ORG, {}, NOV_10_EVENING_CT);
    expect(getComplianceOverview).toHaveBeenCalledTimes(1);
    expect(getComplianceOverview.mock.calls[0]).toEqual([admin, ORG, "2026-11-10"]);
    expectOrgScoped(rec, ORG);
  });

  it("counts files and items from the read, and lists drivers worst item first", async () => {
    const out = (await assistantDriverFiles(db(), ORG, {}, NOV_10_EVENING_CT)) as Out;
    expect(out).toMatchObject({ source: DRIVER_FILES_SOURCE, as_of_day: "2026-11-10", drivers_on_file: 4, drivers_by_file_state: { complete: 1, incomplete: 2, not_started: 1 } });
    expect(out.items_needing_attention).toEqual({
      "Medical card": { expired: 0, expiring: 1, missing: 0 },
      CDL: { expired: 1, expiring: 0, missing: 0 },
      "Annual MVR review": { expired: 0, expiring: 0, missing: 1 },
      "Employment application": { expired: 0, expiring: 0, missing: 1 },
    });
    // The page's rank (`compareFileAttention`): expired, then missing, then expiring.
    expect(out.drivers.map((d: Out) => d.driver)).toEqual(["BEN CRUZ", "DEE PARK", "ANA LOPEZ"]);
    expect(out.drivers[0]).toEqual({
      driver: "BEN CRUZ",
      file_state: "incomplete",
      items: [
        { item: "CDL", state: "expired", good_until: "2026-10-01", days_remaining: -41 },
        { item: "Annual MVR review", state: "missing", good_until: null, days_remaining: null },
      ],
    });
  });

  it("state narrows the items; a named driver is listed even when clean, and a stranger is named back", async () => {
    const expiring = (await assistantDriverFiles(db(), ORG, { state: "expiring" }, NOV_10_EVENING_CT)) as Out;
    expect(expiring.drivers.map((d: Out) => d.driver)).toEqual(["ANA LOPEZ"]);
    const named = (await assistantDriverFiles(db(), ORG, { drivers: ["cal", "zed"] }, NOV_10_EVENING_CT)) as Out;
    expect(named.drivers).toEqual([{ driver: "CAL DIAZ", file_state: "complete", items: [] }]);
    expect(named.not_found).toEqual(["zed"]);
  });

  it("says when the read was partial", async () => {
    getComplianceOverview.mockResolvedValue({ ...OVERVIEW, truncated: true });
    const out = (await assistantDriverFiles(db(), ORG, {}, NOV_10_EVENING_CT)) as Out;
    expect(out.truncated_note ?? "").toMatch(/partial/);
  });

  // F21 R4b, Q-AI13: the roster's File filter is the driver's WORST chip, which agrees with the tool's
  // per-item state only for `expired`; every other answer links to the roster itself.
  it("links with filters only for expired files, the one state the roster's File filter shows exactly", async () => {
    const expired = (await assistantDriverFiles(db(), ORG, { state: "expired" }, NOV_10_EVENING_CT)) as Out;
    expect(expired.link).toEqual({ surfaceKey: "fleet.drivers", query: { file: "expired", status: "any" } });
    expect(expired.link.query).toEqual(driversToQuery({ file: "expired", status: null }));
    for (const input of [{}, { state: "expiring" }, { state: "missing" }, { state: "expired", drivers: ["ben"] }]) {
      const out = (await assistantDriverFiles(db(), ORG, input, NOV_10_EVENING_CT)) as Out;
      expect(out.link, JSON.stringify(input)).toBeUndefined();
    }
  });
});
