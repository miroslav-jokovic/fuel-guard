import { describe, expect, it } from "vitest";
import {
  LUMPER_REMINDER_ALERTS,
  lumperBellKey,
  lumperLineKey,
  lumperReminderAlertFor,
  lumperReminderBellTitle,
  lumperReminderDay,
  lumperReminderLine,
  lumperSweepStaleSince,
  type LumperReminderCase,
} from "./lumperReminder.js";
import { LUMPER_CASE_STATES } from "./lumperCase.js";
import { ALERT_KEYS, alertDefinition, alertMemberCanReceive, alertMemberIsFallback, alertRolesFor, resolveAlertRecipients, type AlertMember } from "./alertRouting.js";
import { NOTIFICATION_CATEGORIES, deepLinkFor } from "./notificationsContract.js";

/**
 * The daily lumper reminder's rules (LUMPER-REVISED-RC-PLAN LRC4): when it is due (Q-LRC2), which case is
 * in which reminder (D-LRC4, Q-LRC9), what a line says, and who may receive it (D-LRC11: the Lumper fees
 * screen, not a section).
 */
const CHICAGO = "America/Chicago";

describe("when the reminder is due (Q-LRC2: 08:00 Central, Monday to Friday)", () => {
  it("is due from 08:00 on the carrier's clock on a weekday, and names that day", () => {
    // Tuesday 2026-11-17: 08:00 CST is 14:00Z.
    expect(lumperReminderDay(new Date("2026-11-17T13:59:00Z"), CHICAGO)).toBeNull();
    expect(lumperReminderDay(new Date("2026-11-17T14:00:00Z"), CHICAGO)).toBe("2026-11-17");
    // Still that day at 23:59 Central (05:59Z the next UTC day): a server down at 08:00 sends it when back.
    expect(lumperReminderDay(new Date("2026-11-18T05:59:00Z"), CHICAGO)).toBe("2026-11-17");
  });

  it("is never due on a Saturday or a Sunday", () => {
    expect(lumperReminderDay(new Date("2026-11-21T15:00:00Z"), CHICAGO)).toBeNull();
    expect(lumperReminderDay(new Date("2026-11-22T15:00:00Z"), CHICAGO)).toBeNull();
    // Friday evening Central is Saturday in UTC: still Friday's reminder.
    expect(lumperReminderDay(new Date("2026-11-21T02:00:00Z"), CHICAGO)).toBe("2026-11-20");
  });

  it("follows the carrier's clock across daylight saving: 08:00 CDT is 13:00Z", () => {
    expect(lumperReminderDay(new Date("2026-07-14T12:59:00Z"), CHICAGO)).toBeNull();
    expect(lumperReminderDay(new Date("2026-07-14T13:00:00Z"), CHICAGO)).toBe("2026-07-14");
  });
});

describe("which reminder a case is in (D-LRC4)", () => {
  it("puts each state that asks for somebody in exactly one reminder, and the done states in none", () => {
    const got = Object.fromEntries(LUMPER_CASE_STATES.map((s) => [s, lumperReminderAlertFor(s, true)]));
    expect(got).toEqual({
      waiting_for_rc: "lumper_rc_waiting",
      rc_received: null,
      billed_no_rc: "lumper_rc_missing_billed",
      billed_without_lumper: "lumper_billing_gap",
      billed_short: "lumper_billing_gap",
      billed_rc_on_file: null,
      closed_not_billable: null,
      charge_removed: null,
    });
  });

  it("keeps reminding about a missing RC on a case older than the read, but not about its frozen billing (Q-LRC9)", () => {
    expect(lumperReminderAlertFor("waiting_for_rc", false)).toBe("lumper_rc_waiting");
    expect(lumperReminderAlertFor("billed_no_rc", false)).toBe("lumper_rc_missing_billed");
    expect(lumperReminderAlertFor("billed_without_lumper", false)).toBeNull();
    expect(lumperReminderAlertFor("billed_short", false)).toBeNull();
  });

  it("names three alerts that are all in the catalogue and the bell's categories, and opens the list", () => {
    for (const a of LUMPER_REMINDER_ALERTS) {
      expect(ALERT_KEYS).toContain(a);
      expect(NOTIFICATION_CATEGORIES).toContain(a);
      expect(deepLinkFor(a, null)).toBe("/lumper-fees");
    }
  });
});

describe("what a line says (D-LRC10: where and what we paid)", () => {
  const c = (o: Partial<LumperReminderCase> = {}): LumperReminderCase => ({
    orderId: "0291013", state: "waiting_for_rc", customerName: "A Broker", consigneeCity: "Joliet", consigneeState: "IL",
    paidAmount: 310, paidAt: "2026-10-02T00:00:00Z", chargeAmount: 310, billedAmount: 0, shortAmount: 0, ...o,
  });

  it("leads with the order, then the broker, what and when we paid, and where", () => {
    expect(lumperReminderLine(c())).toBe("Order 0291013 · A Broker · paid $310.00 on 10/02/2026 · Joliet, IL");
  });

  it("says a keyed amount is not a payment yet", () => {
    expect(lumperReminderLine(c({ paidAmount: 0, paidAt: null, chargeAmount: 150 }))).toBe("Order 0291013 · A Broker · keyed $150.00, payment not recorded yet · Joliet, IL");
  });

  it("says what the invoice did for a billing gap", () => {
    expect(lumperReminderLine(c({ state: "billed_without_lumper" }))).toMatch(/· invoiced with no lumper$/);
    expect(lumperReminderLine(c({ state: "billed_short", billedAmount: 120, shortAmount: 80 }))).toMatch(/· invoiced \$120\.00, \$80\.00 short$/);
  });

  it("leaves out what McLeod did not send rather than printing a blank", () => {
    expect(lumperReminderLine(c({ customerName: null, consigneeCity: null, consigneeState: null }))).toBe("Order 0291013 · paid $310.00 on 10/02/2026");
  });

  it("counts the loads on the bell, and says when McLeod was last read once that is over a day", () => {
    expect(lumperReminderBellTitle("lumper_rc_waiting", 1, null)).toBe("Revised RC missing on 1 load");
    expect(lumperReminderBellTitle("lumper_billing_gap", 4, "2026-11-14T10:00:00Z")).toBe("Lumper not billed in full on 4 loads (McLeod last read 11/14/2026)");
    const now = new Date("2026-11-17T14:00:00Z");
    expect(lumperSweepStaleSince("2026-11-16T13:00:00Z", now)).toBeNull();
    expect(lumperSweepStaleSince("2026-11-16T11:59:00Z", now)).toBe("2026-11-16T11:59:00Z");
    expect(lumperSweepStaleSince(null, now)).toBeNull();
  });

  it("keys the bell once per alert per day, and each line once per case per day", () => {
    expect(lumperBellKey("lumper_rc_waiting", "2026-11-17")).not.toBe(lumperBellKey("lumper_rc_waiting", "2026-11-18"));
    expect(lumperBellKey("lumper_rc_waiting", "2026-11-17")).not.toBe(lumperBellKey("lumper_billing_gap", "2026-11-17"));
    expect(lumperLineKey("lumper_rc_waiting", "2026-11-17", "c1")).not.toBe(lumperLineKey("lumper_rc_waiting", "2026-11-17", "c2"));
  });
});

describe("who may receive a lumper reminder: the Lumper fees screen (D-LRC11)", () => {
  const def = alertDefinition("lumper_billing_gap");
  const m = (userId: string, role: AlertMember["role"], o: Partial<AlertMember> = {}): AlertMember => ({ userId, role, ...o });

  it("reaches accounting, which holds no Dispatch, and not a role the screen does not start on for", () => {
    expect(alertMemberCanReceive(m("acc", "accountant"), def)).toBe(true);
    expect(alertMemberCanReceive(m("dsp", "dispatcher"), def)).toBe(true);
    expect(alertMemberCanReceive(m("rec", "recruiter"), def)).toBe(false);
    expect(alertRolesFor(def, {})).toEqual(expect.arrayContaining(["admin", "accountant", "dispatcher", "fleet_manager"]));
    expect(alertRolesFor(def, {})).not.toContain("recruiter");
  });

  it("follows the carrier's Permissions page: a role or a person given the screen, or denied it", () => {
    expect(alertMemberCanReceive(m("acc", "accountant", { surfaces: { "dispatch.lumper-cases": false } }), def)).toBe(false);
    expect(alertMemberCanReceive(m("rec", "recruiter", { surfaces: { "dispatch.lumper-cases": true } }), def)).toBe(true);
    expect(alertRolesFor(def, {}, { accountant: { "dispatch.lumper-cases": false } })).not.toContain("accountant");
    expect(alertRolesFor(def, {}, { recruiter: { "dispatch.lumper-cases": true } })).toContain("recruiter");
  });

  it("sends the order's dispatcher the RC reminder by default, and drops one the carrier took the screen from", () => {
    const members = [m("dana", "dispatcher"), m("ada", "admin"), m("acc", "accountant")];
    const got = resolveAlertRecipients("lumper_rc_waiting", [], members, { order_dispatcher: "dana" });
    expect([...got.keys()].sort()).toEqual(["ada", "dana"]);
    expect([...got.get("dana")!].sort()).toEqual(["bell", "email"]);
    const off = resolveAlertRecipients("lumper_rc_waiting", [], [m("dana", "dispatcher", { surfaces: { "dispatch.lumper-cases": false } }), m("ada", "admin")], { order_dispatcher: "dana" });
    expect([...off.keys()]).toEqual(["ada"]);
  });

  it("falls back to the admins who can open the screen when the routes reach nobody", () => {
    expect(alertMemberIsFallback(m("ada", "admin"), def)).toBe(true);
    expect(alertMemberIsFallback(m("fran", "fleet_manager"), def)).toBe(false);
    // A home-time alert still falls back to who MANAGES Dispatch, as before.
    expect(alertMemberIsFallback(m("fran", "fleet_manager"), alertDefinition("home_time_overdue"))).toBe(true);
  });
});
