import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { sendCardStatusSummary } from "./cardStatusSummary.js";

/**
 * The daily card status summary (Q-F3; F02-F04 PLAN.md chunk 3b). Accept, from the plan: exactly one
 * per recipient per day, and none on a day with no changes.
 *
 * What can be wrong:
 *
 *  - IT IS SENT EVERY FIVE MINUTES. It rides the status poll, which runs ~60 times in its window. The
 *    morning below is replayed poll by poll against a fake of the dedupe ledger (0432 keeps a key per
 *    person forever), and each person must end with one message.
 *  - "YESTERDAY" IS THE UTC DAY. The audit rows are read for the org's calendar day: 05:00Z to 05:00Z
 *    for a Central day in October, not midnight to midnight UTC.
 *  - A QUIET DAY IS A MESSAGE, OR A LOOKUP. No changes sends nothing and looks nobody up.
 */
const ORG = "org-1";
const CHICAGO = { id: ORG, operating_hours: { start: "00:00", end: "00:00", tz: "America/Chicago" } };
const MANAGERS = [{ user_id: "u-fleet" }, { user_id: "u-admin" }];
const card = (n: number, unit: string | null, driver: string | null) => ({
  id: `card-${n}`,
  unit_prompt: unit,
  driver_name: driver,
  card_last4: String(n).padStart(4, "0"),
});
const audit = (n: number, from: string, to: string) => ({ entity_id: `card-${n}`, meta: { from, to, last4: String(n).padStart(4, "0") } });
const YESTERDAYS = [audit(1, "ACTIVE", "HOLD"), audit(2, "ACTIVE", "HOLD"), audit(1, "HOLD", "ACTIVE")];

/** The dedupe ledger, faked as 0432 behaves: a key is kept per (person, key), forever. */
const ledger = vi.hoisted(() => ({ keys: new Set<string>(), sent: [] as Array<Record<string, unknown>> }));
vi.mock("../../messaging/index.js", () => ({
  notify: vi.fn(async (_admin: unknown, input: Record<string, unknown>) => {
    const k = `${input.userId}|${input.dedupeKey}`;
    if (ledger.keys.has(k)) return null;
    ledger.keys.add(k);
    ledger.sent.push(input);
    return "evt";
  }),
  keysAlreadySent: vi.fn(async (_admin: unknown, _org: string, keys: string[]) =>
    new Set(keys.filter((key) => [...ledger.keys].some((k) => k.endsWith(`|${key}`))))),
}));

const recorder = (auditRows: unknown[]) =>
  createSupabaseRecorder({
    tables: {
      organizations: [CHICAGO],
      audit_logs: auditRows,
      efs_cards: [card(1, "887", "TEST DRIVER ONE"), card(2, null, null)],
      memberships: MANAGERS,
    },
  });

/** 08:00 Tuesday 2026-10-06 in Chicago (CDT, UTC−5). */
const TUESDAY_8AM = new Date("2026-10-06T13:00:00Z");

beforeEach(() => {
  ledger.keys.clear();
  ledger.sent.length = 0;
});

describe("the daily card status summary", () => {
  it("sends each fuel manager yesterday's changes, by truck, keyed on yesterday", async () => {
    const rec = recorder(YESTERDAYS);
    const result = await sendCardStatusSummary(rec.client, ORG, TUESDAY_8AM);
    expect(result).toEqual({ day: "2026-10-05", sent: 2, skipped: null });
    expect(ledger.sent.map((n) => n.userId).sort()).toEqual(["u-admin", "u-fleet"]);
    expect(ledger.sent[0]).toMatchObject({
      orgId: ORG,
      category: "card_status_changed",
      severity: "info",
      dedupeKey: "card_status_summary:2026-10-05",
      title: "Yesterday 2 cards went on hold and 1 came back",
      body: "Truck 887 · TEST DRIVER ONE · ••••0001: Active → On hold → Active\n••••0002: Active → On hold",
    });
    expect(ledger.sent[0]).not.toHaveProperty("entityId");
    expectOrgScoped(rec, ORG);
  });

  it("reads the org's calendar day, not the UTC one", async () => {
    const rec = recorder(YESTERDAYS);
    await sendCardStatusSummary(rec.client, ORG, TUESDAY_8AM);
    const q = rec.forTable("audit_logs")[0]!;
    const bound = (method: string) => q.ops.find((o) => o.method === method && o.args[0] === "created_at")?.args[1];
    expect(bound("gte")).toBe("2026-10-05T05:00:00.000Z");
    expect(bound("lt")).toBe("2026-10-06T05:00:00.000Z");
    expect(q.filters()).toEqual(expect.arrayContaining([{ col: "action", val: "card.status_changed_externally" }]));
  });

  it("takes 'yesterday' from the org's calendar where it differs from UTC's", async () => {
    // In Chicago the 07:00–12:00 window is the same UTC date, so a UTC "today" cannot show there.
    // 08:00 Tuesday in Tokyo is 23:00 MONDAY in UTC: yesterday is Monday, not Sunday.
    const rec = createSupabaseRecorder({
      tables: { organizations: [{ id: ORG, operating_hours: { tz: "Asia/Tokyo" } }], audit_logs: YESTERDAYS, efs_cards: [], memberships: MANAGERS },
    });
    const result = await sendCardStatusSummary(rec.client, ORG, new Date("2026-10-05T23:00:00Z"));
    expect(result.day).toBe("2026-10-05");
    const q = rec.forTable("audit_logs")[0]!;
    expect(q.ops.find((o) => o.method === "gte")?.args[1]).toBe("2026-10-04T15:00:00.000Z");
  });

  it("sends exactly one per person across a whole morning of polls", async () => {
    let sent = 0;
    // Every five minutes from 06:00 to 12:55 Chicago — before, through and after the window.
    for (let minute = 0; minute < 7 * 60; minute += 5) {
      const at = new Date(Date.parse("2026-10-06T11:00:00Z") + minute * 60_000);
      sent += (await sendCardStatusSummary(recorder(YESTERDAYS).client, ORG, at)).sent;
    }
    expect(sent).toBe(2);
    expect(ledger.sent.map((n) => n.userId).sort()).toEqual(["u-admin", "u-fleet"]);
  });

  it("after the first, a poll reads no audit rows at all", async () => {
    await sendCardStatusSummary(recorder(YESTERDAYS).client, ORG, TUESDAY_8AM);
    const rec = recorder(YESTERDAYS);
    expect(await sendCardStatusSummary(rec.client, ORG, new Date("2026-10-06T13:05:00Z"))).toMatchObject({ skipped: "already_sent" });
    expect(rec.forTable("audit_logs")).toHaveLength(0);
  });

  it("sends a new one the next day", async () => {
    await sendCardStatusSummary(recorder(YESTERDAYS).client, ORG, TUESDAY_8AM);
    const next = await sendCardStatusSummary(recorder(YESTERDAYS).client, ORG, new Date("2026-10-07T13:00:00Z"));
    expect(next).toEqual({ day: "2026-10-06", sent: 2, skipped: null });
  });

  it("sends nothing, and looks nobody up, on a day with no changes", async () => {
    const rec = recorder([]);
    expect(await sendCardStatusSummary(rec.client, ORG, TUESDAY_8AM)).toEqual({ day: "2026-10-05", sent: 0, skipped: "no_changes" });
    expect(ledger.sent).toHaveLength(0);
    expect(rec.forTable("memberships")).toHaveLength(0);
  });

  it("waits for 07:00 and stops at 12:00 on the org's clock", async () => {
    expect((await sendCardStatusSummary(recorder(YESTERDAYS).client, ORG, new Date("2026-10-06T11:59:00Z"))).skipped).toBe("outside_window");
    expect((await sendCardStatusSummary(recorder(YESTERDAYS).client, ORG, new Date("2026-10-06T17:00:00Z"))).skipped).toBe("outside_window");
    expect(ledger.sent).toHaveLength(0);
  });
});
