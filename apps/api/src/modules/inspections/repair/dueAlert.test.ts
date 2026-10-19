import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoadsideRepairDueDto } from "@silvicom/shared";

/**
 * The `roadside_repair_due` alert (IC11 B2b). What it can get wrong: ring for a settled unit, ring the
 * whole year's backlog on its first run, ring every hour instead of once per stage, ring safety instead of
 * maintenance, or point at something other than the inspection (the bell routes by reader from it).
 */

const sent: Record<string, unknown>[] = [];
vi.mock("../../messaging/index.js", () => ({
  notify: vi.fn(async (_admin: unknown, input: Record<string, unknown>) => {
    sent.push(input);
    return `n-${sent.length}`;
  }),
}));
const asked: string[] = [];
vi.mock("../../org/index.js", () => ({
  usersWhoManage: vi.fn(async (_admin: unknown, _org: string, section: string) => {
    asked.push(section);
    return ["u-shop", "u-admin"];
  }),
}));
let due: RoadsideRepairDueDto[] | { error: { message: string } } = [];
vi.mock("../read/repairsDue.js", () => ({ readRepairsDue: vi.fn(async () => due) }));

const { alertRepairsDue, repairDueNotice } = await import("./dueAlert.js");

const unit = (o: Partial<RoadsideRepairDueDto> = {}): RoadsideRepairDueDto => ({
  unitId: "u-1", unit: { seq: 1, kind: "tractor", companyNumber: "612" }, violations: [], dueOn: "2026-10-21",
  proposal: { outcome: "no_candidate", candidates: [], readAt: "x" }, decision: null, basedOn: "r-1",
  inspection: { id: "insp-1", reportNumber: "IL0912", reportState: "IL", inspectionDate: "2026-10-06", locationDesc: null },
  ...o,
});

beforeEach(() => {
  sent.length = 0;
  asked.length = 0;
});

describe("the repair-due alert", () => {
  it("rings maintenance's managers three days out, about the inspection, once per unit and stage", async () => {
    due = [unit()];
    expect(await alertRepairsDue({} as never, "org-1", "2026-10-18")).toBe(2);
    expect(asked).toEqual(["maintenance"]);
    expect(sent.map((s) => s.userId)).toEqual(["u-shop", "u-admin"]);
    expect(sent[0]).toMatchObject({
      category: "roadside_repair_due", severity: "warning", entityType: "roadside_inspection", entityId: "insp-1",
      dedupeKey: "roadside-repair-due:u-1:due_soon", title: "Truck 612: roadside repair due 10/21/2026",
    });
  });

  it("rings again, as critical, once the due day has passed", async () => {
    due = [unit()];
    await alertRepairsDue({} as never, "org-1", "2026-10-23");
    expect(sent[0]).toMatchObject({ severity: "critical", dedupeKey: "roadside-repair-due:u-1:overdue", title: "Truck 612: roadside repair overdue" });
    expect(sent[0]!.body).toContain("(2 days ago)");
  });

  it("is quiet for a settled unit, one not yet near its day, and the old backlog — and asks nobody", async () => {
    due = [
      unit({ decision: { outcome: "accepted", workOrder: null, note: null, decidedBy: "Pat", decidedAt: "x" } }),
      unit({ unitId: "u-2", dueOn: "2026-10-30" }),
      unit({ unitId: "u-3", dueOn: "2026-09-01" }),
    ];
    expect(await alertRepairsDue({} as never, "org-1", "2026-10-19")).toBe(0);
    expect(sent).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("never throws into the scheduler when the read fails", async () => {
    due = { error: { message: "boom" } };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(alertRepairsDue({} as never, "org-1", "2026-10-19")).resolves.toBe(0);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("names the report and its date in the words", () => {
    expect(repairDueNotice(unit(), "due_soon", "2026-10-18").body).toBe(
      "The violations on report IL0912 of 10/06/2026 must be repaired and recorded by 10/21/2026 (49 CFR 396.9(d)). Name the FleetPal work order that repaired them, or say where it was repaired.",
    );
  });
});
