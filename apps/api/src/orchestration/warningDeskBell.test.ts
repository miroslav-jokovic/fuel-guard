import { describe, expect, it, vi } from "vitest";
import { FIXED_RULES } from "@silvicom/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DESK_SURFACE, ringUrgentFollowUps, type BellDeps } from "./warningDeskBell.js";
import type { FollowUpRow } from "../modules/followups/index.js";

/**
 * The warning desk's bell (WARNING-DESK-PLAN WD6, D-WD14): every holder of the desk's screen hears an
 * urgent follow-up once, with a link to that line, and nobody hears anything else.
 */
const ORG = "00000000-0000-4000-8000-0000000000aa";
const admin = {} as SupabaseClient;
const row = (o: Partial<FollowUpRow> = {}): FollowUpRow => ({
  id: "f1", rule_key: "lamp_stop", category: "maintenance", severity: "urgent", subject_kind: "truck", subject_samsara_id: "s-v",
  subject_name: "847", driver_samsara_id: null, driver_name: null, status: "new", outcome: null, warning_count: 1, active_count: 1,
  first_at: "2026-11-26T11:00:00Z", last_at: "2026-11-26T11:00:00Z", contacted_at: null, closed_at: null, assignee_id: null, version: 1, ...o,
});

type Sent = Parameters<BellDeps["send"]>[1];
function deps(o: Partial<BellDeps> = {}) {
  const send = vi.fn<BellDeps["send"]>(async () => "n");
  const d = { holders: vi.fn(async () => ["u1", "u2"]), send, read: vi.fn(async () => [row()]), ...o };
  return { ...d, sent: (): Sent[] => send.mock.calls.map((c) => c[1]) };
}

describe("ringUrgentFollowUps", () => {
  it("rings every holder of Maintenance › Follow-ups once per follow-up, deduped on the follow-up", async () => {
    const d = deps();
    expect(await ringUrgentFollowUps(admin, ORG, ["f1"], FIXED_RULES, d)).toBe(2);
    expect(d.holders).toHaveBeenCalledWith(admin, ORG, DESK_SURFACE);
    expect(d.read).toHaveBeenCalledWith(admin, ORG, ["f1"]);
    expect(d.sent()).toEqual(
      ["u1", "u2"].map((userId) => ({
        orgId: ORG, userId, category: "follow_up_urgent", title: "Urgent: Red STOP lamp on",
        body: "Truck 847. Call the driver from Maintenance › Follow-ups.", severity: "critical",
        entityType: "follow_up", entityId: "f1", dedupeKey: "follow_up:f1",
      })),
    );
  });

  it("asks nobody anything when no follow-up opened urgent", async () => {
    const d = deps();
    expect(await ringUrgentFollowUps(admin, ORG, [], FIXED_RULES, d)).toBe(0);
    expect(d.read).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });

  it("counts only the notifications written — a mute, quiet hours or the dedupe answer null", async () => {
    const d = deps({ send: vi.fn<BellDeps["send"]>().mockResolvedValueOnce("n").mockResolvedValueOnce(null) });
    expect(await ringUrgentFollowUps(admin, ORG, ["f1"], FIXED_RULES, d)).toBe(1);
  });

  it("names a driver's problem by the driver, without a unit word", async () => {
    const d = deps({ read: vi.fn(async () => [row({ rule_key: "safety_serious", subject_kind: "driver", subject_name: "Ana Safe" })]) });
    await ringUrgentFollowUps(admin, ORG, ["f1"], FIXED_RULES, d);
    expect(d.sent()[0]).toMatchObject({ title: "Urgent: Serious driving event", body: "Ana Safe. Call the driver from Maintenance › Follow-ups." });
  });
});
