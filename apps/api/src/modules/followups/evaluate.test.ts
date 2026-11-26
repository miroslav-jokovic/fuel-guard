import { describe, expect, it } from "vitest";
import { FIXED_RULES, type FollowUpRule } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { evaluateFollowUps, type EvaluatedWarning, type WarningReaders } from "./evaluate.js";

const ORG = "org-1";
const NOW = new Date("2026-11-26T12:00:00.000Z");
const H = 3_600_000;
const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * H).toISOString();
const rules: FollowUpRule[] = FIXED_RULES.map((r) => ({ ...r }));

/** An ATIS episode on trailer T1 that lasted 30 minutes. */
const episode = (hoursAgo: number, over: Partial<EvaluatedWarning> = {}): EvaluatedWarning => ({
  kind: "atis",
  subjectKind: "trailer",
  subjectId: "T1",
  vehicleSamsaraId: null,
  trailerSamsaraId: "T1",
  driverSamsaraId: null,
  unitName: "R535973",
  driverName: null,
  label: "Trailer tire losing air (ATIS lamp on)",
  happenedAt: at(hoursAgo),
  endedAt: at(hoursAgo - 0.5),
  stillActive: false,
  ...over,
});

function readers(warnings: EvaluatedWarning[]): WarningReaders & { subjectCalls: unknown[] } {
  const subjectCalls: unknown[] = [];
  return {
    subjectCalls,
    updatedSince: async () => warnings,
    active: async (kinds) => warnings.filter((w) => w.stillActive && kinds.includes(w.kind)),
    subject: async (q) => {
      subjectCalls.push(q);
      return warnings.filter((w) => w.kind === q.kind && w.subjectKind === q.subjectKind && q.subjectIds.includes(w.subjectId ?? ""));
    },
  };
}

function recorder(open: unknown[] = [], closed: unknown[] = []) {
  return createSupabaseRecorder({
    tables: {
      follow_ups: (q) => {
        if (q.write) return [{ id: "fu-new" }];
        // The open read filters `.neq("status", "closed")`, the closed read `.eq("status", "closed")`.
        const closedRead = q.ops.some((o) => o.method === "eq" && o.args[0] === "status");
        return closedRead ? closed : open;
      },
    },
  });
}

const run = (rec: ReturnType<typeof recorder>, ws: EvaluatedWarning[]) =>
  evaluateFollowUps(rec.client, ORG, { now: NOW, rules, sinceIso: at(1), readers: readers(ws) });

describe("evaluateFollowUps", () => {
  it("opens one follow-up on the third ATIS episode inside a week", async () => {
    const rec = recorder();
    const r = await run(rec, [episode(100), episode(50), episode(2)]);
    expect(r).toMatchObject({ opened: 1, refreshed: 0 });
    expect(rec.writtenRows("follow_ups")).toMatchObject([
      { org_id: ORG, rule_key: "atis", category: "maintenance", subject_kind: "trailer", subject_samsara_id: "T1", subject_name: "R535973", status: "new", warning_count: 3, first_at: at(100) },
    ]);
    expectOrgScoped(rec, ORG);
  });

  it("does not open on the second", async () => {
    const rec = recorder();
    expect((await run(rec, [episode(50), episode(2)])).opened).toBe(0);
    expect(rec.writes()).toHaveLength(0);
  });

  it("ignores lamp blips shorter than ten minutes", async () => {
    const rec = recorder();
    const blip = (h: number) => episode(h, { endedAt: at(h - 0.05) });
    expect((await run(rec, [blip(100), blip(50), blip(2)])).opened).toBe(0);
  });

  it("attaches a new warning to the open follow-up and never touches its status", async () => {
    const open = [{ id: "fu-1", rule_key: "atis", subject_kind: "trailer", subject_samsara_id: "T1", severity: "normal", warning_count: 3, active_count: 0, first_at: at(100), last_at: at(10), subject_name: "R535973", driver_samsara_id: null, driver_name: null }];
    const rec = recorder(open);
    const r = await run(rec, [episode(100), episode(50), episode(10), episode(1, { stillActive: true, endedAt: null })]);
    expect(r).toMatchObject({ opened: 0, refreshed: 1 });
    const [update] = rec.writtenRows("follow_ups");
    expect(update).toMatchObject({ warning_count: 4, active_count: 1, last_at: at(1) });
    expect(update).not.toHaveProperty("status");
    expect(update).not.toHaveProperty("version");
  });

  it("writes nothing when an open follow-up is already current", async () => {
    const open = [{ id: "fu-1", rule_key: "atis", subject_kind: "trailer", subject_samsara_id: "T1", severity: "normal", warning_count: 3, active_count: 0, first_at: at(100), last_at: at(2), subject_name: "R535973", driver_samsara_id: null, driver_name: null }];
    const rec = recorder(open);
    expect((await run(rec, [episode(100), episode(50), episode(2)])).refreshed).toBe(0);
    expect(rec.writes()).toHaveLength(0);
  });

  it("counts again from zero after the last follow-up was closed", async () => {
    const rec = recorder([], [{ rule_key: "atis", subject_kind: "trailer", subject_samsara_id: "T1", closed_at: at(60) }]);
    expect((await run(rec, [episode(100), episode(50), episode(2)])).opened).toBe(0);
  });

  it("opens a serious driving event the first time, and a crash as urgent for the bell", async () => {
    const rec = recorder();
    const crash: EvaluatedWarning = { ...episode(1), kind: "safety_serious", subjectKind: "driver", subjectId: "D1", driverSamsaraId: "D1", driverName: "Dante", trailerSamsaraId: null, label: "Crash", endedAt: at(1) };
    const r = await run(rec, [crash]);
    expect(r).toMatchObject({ opened: 1, urgentOpened: ["fu-new"] });
    expect(rec.writtenRows("follow_ups")).toMatchObject([{ rule_key: "safety_serious", severity: "urgent", subject_name: "Dante", driver_name: "Dante" }]);
  });

  it("opens a defect only after it has stayed open two days", async () => {
    const defect = (hoursAgo: number): EvaluatedWarning => ({ ...episode(hoursAgo), kind: "dvir_open", subjectKind: "truck", subjectId: "V1", vehicleSamsaraId: "V1", trailerSamsaraId: null, stillActive: true, endedAt: null });
    expect((await run(recorder(), [defect(40)])).opened).toBe(0);
    expect((await run(recorder(), [defect(50)])).opened).toBe(1);
  });

  it("skips warnings of a kind no rule knows (a dismissed safety event)", async () => {
    const rec = recorder();
    const dismissed: EvaluatedWarning = { ...episode(1), kind: "safety_dismissed", subjectKind: "driver", subjectId: "D1" };
    expect((await run(rec, [dismissed])).problems).toBe(0);
  });
});
