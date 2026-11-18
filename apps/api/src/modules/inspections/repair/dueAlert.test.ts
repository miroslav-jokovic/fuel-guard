import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoadsideRepairDueDto } from "@silvicom/shared";

/**
 * The `roadside_repair_due` alert (IC11 B2b; routed since RR5). What it can get wrong: ring for a settled unit,
 * ring the whole year's backlog on its first run, ring every hour instead of once per stage, change the keys
 * the bell already used (re-sending everything once), go around the carrier's routes, or point at something
 * other than the inspection (the bell routes by reader from it).
 */

/** What `sendAlerts` was handed — routing itself (who, which channel, fallback) is alertRouting.test.ts's. */
const calls: { alert: string; events: Record<string, unknown>[]; clock: unknown }[] = [];
vi.mock("../../messaging/index.js", () => ({
  sendAlerts: vi.fn(async (_admin: unknown, _env: unknown, _org: string, alert: string, events: Record<string, unknown>[], clock: unknown) => {
    calls.push({ alert, events, clock });
    return { bells: events.length * 2, emails: 0, texts: 0, textsHeld: 0, fellBack: 0 };
  }),
}));
let due: RoadsideRepairDueDto[] | { error: { message: string } } = [];
vi.mock("../read/repairsDue.js", () => ({ readRepairsDue: vi.fn(async () => due) }));

const { alertRepairsDue, repairDueNotice } = await import("./dueAlert.js");

const unit = (o: Partial<RoadsideRepairDueDto> = {}): RoadsideRepairDueDto => ({
  unitId: "u-1", unit: { seq: 1, kind: "tractor", companyNumber: "612" }, violations: [], dueOn: "2026-10-21",
  proposal: { outcome: "no_candidate", candidates: [], readAt: "x" }, decision: null, basedOn: "r-1", invoiceCounts: {}, beforeRecord: false,
  inspection: { id: "insp-1", reportNumber: "IL0912", reportState: "IL", inspectionDate: "2026-10-06", locationDesc: null },
  ...o,
});

const CLOCK = { zone: "America/Chicago", now: new Date("2026-10-18T14:00:00Z") };
const send = (today: string) => alertRepairsDue({} as never, {} as never, "org-1", today, CLOCK);

beforeEach(() => {
  calls.length = 0;
});

describe("the repair-due alert", () => {
  it("hands the carrier's routing one event per unit three days out, on the keys the bell already used", async () => {
    due = [unit()];
    expect(await send("2026-10-18")).toBe(2);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ alert: "roadside_repair_due", clock: CLOCK });
    expect(calls[0]!.events).toEqual([{
      dedupeKey: "roadside-repair-due:u-1:due_soon", line: "Truck 612: roadside repair due 10/21/2026", severity: "warning",
      entityType: "roadside_inspection", entityId: "insp-1", relations: {},
    }]);
  });

  it("rings again, as critical, once the due day has passed", async () => {
    due = [unit()];
    await send("2026-10-23");
    expect(calls[0]!.events[0]).toMatchObject({ severity: "critical", dedupeKey: "roadside-repair-due:u-1:overdue", line: "Truck 612: roadside repair overdue" });
  });

  it("is quiet for a settled unit, one not yet near its day, and the old backlog — and sends nothing", async () => {
    due = [
      unit({ decision: { outcome: "accepted", workOrder: null, note: null, decidedBy: "Pat", decidedAt: "x" } }),
      unit({ unitId: "u-2", dueOn: "2026-10-30" }),
      unit({ unitId: "u-3", dueOn: "2026-09-01" }),
    ];
    expect(await send("2026-10-19")).toBe(0);
    expect(calls).toEqual([]);
  });

  it("never throws into the scheduler when the read fails", async () => {
    due = { error: { message: "boom" } };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(send("2026-10-19")).resolves.toBe(0);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("names the report and its date in the words", () => {
    expect(repairDueNotice(unit(), "due_soon", "2026-10-18").body).toBe(
      "The violations on report IL0912 of 10/06/2026 must be repaired and recorded by 10/21/2026 (49 CFR 396.9(d)). Name the FleetPal work order that repaired them, or say where it was repaired.",
    );
  });
});
