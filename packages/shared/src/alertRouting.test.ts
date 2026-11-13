import { describe, expect, it } from "vitest";
import {
  ALERT_CATALOGUE,
  ALERT_KEYS,
  alertDefinition,
  isAlertKey,
  resolveAlertRecipients,
  routesInForce,
  type AlertMember,
  type AlertRoute,
} from "./alertRouting.js";
import { rolesThatCanView } from "./auth.js";
import { NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORY_LABELS } from "./notificationsContract.js";
import {
  HOME_TIME_OVERDUE_REPEATS,
  homeTimeAlertLine,
  homeTimeAlertsDue,
  type HomeTimeAlertKind,
} from "./homeTime.js";
import { HOME_TIME_DEFAULTS } from "./homeTimeContract.js";

const DANA = "u-dana"; // dispatcher, marked the period
const IVO = "u-ivo"; // dispatcher, runs the truck's fleet
const FRAN = "u-fran"; // fleet manager
const ADA = "u-ada"; // admin
const REX = "u-rex"; // recruiter: cannot view Dispatch
const MEMBERS: AlertMember[] = [
  { userId: DANA, role: "dispatcher" },
  { userId: IVO, role: "dispatcher" },
  { userId: FRAN, role: "fleet_manager" },
  { userId: ADA, role: "admin" },
  { userId: REX, role: "recruiter" },
];
const REL = { marked_by: DANA, truck_dispatcher: IVO };
const got = (m: Map<string, Set<string>>) => Object.fromEntries([...m].map(([u, c]) => [u, [...c].sort()]).sort());
const route = (recipientKind: AlertRoute["recipientKind"], recipientKey: string, channel: AlertRoute["channel"], enabled = true): AlertRoute => ({ recipientKind, recipientKey, channel, enabled });

describe("the catalogue", () => {
  it("names each alert by its bell category, with that category's label", () => {
    for (const a of ALERT_CATALOGUE) {
      expect(NOTIFICATION_CATEGORIES).toContain(a.key);
      expect(a.label).toBe(NOTIFICATION_CATEGORY_LABELS[a.key]);
    }
    expect(ALERT_KEYS).toEqual(["home_time_return_due", "home_time_overdue", "home_time_truck_limit"]);
    expect(isAlertKey("home_time_overdue")).toBe(true);
    expect(isAlertKey("fuel_alert")).toBe(false);
  });

  it("starts SMS off for everybody: nobody has a confirmed number until they give one", () => {
    expect(ALERT_CATALOGUE.flatMap((a) => a.defaults).filter((r) => r.channel === "sms")).toEqual([]);
  });

  it("defaults only to roles that can view the alert's section", () => {
    for (const a of ALERT_CATALOGUE) {
      const viewers = rolesThatCanView(a.section) as string[];
      for (const r of a.defaults) if (r.recipientKind === "role") expect(viewers).toContain(r.recipientKey);
    }
  });
});

describe("resolveAlertRecipients — the defaults (D-HT15)", () => {
  it("tells whoever marked it and the truck's dispatcher that home time is ending, on the dashboard only", () => {
    expect(got(resolveAlertRecipients("home_time_return_due", [], MEMBERS, REL))).toEqual({ [DANA]: ["bell"], [IVO]: ["bell"] });
  });

  it("adds the fleet manager by dashboard and email for an overstay and for a truck at home too long", () => {
    const want = { [DANA]: ["bell"], [IVO]: ["bell"], [FRAN]: ["bell", "email"] };
    expect(got(resolveAlertRecipients("home_time_overdue", [], MEMBERS, REL))).toEqual(want);
    expect(got(resolveAlertRecipients("home_time_truck_limit", [], MEMBERS, REL))).toEqual(want);
  });

  it("reaches one person once when he both marked it and runs the fleet", () => {
    expect(got(resolveAlertRecipients("home_time_return_due", [], MEMBERS, { marked_by: DANA, truck_dispatcher: DANA }))).toEqual({ [DANA]: ["bell"] });
  });

  it("reaches nobody through a relation that resolved to nobody — the truck's fleet has no linked dispatcher", () => {
    expect(got(resolveAlertRecipients("home_time_return_due", [], MEMBERS, { marked_by: DANA, truck_dispatcher: null }))).toEqual({ [DANA]: ["bell"] });
    expect(resolveAlertRecipients("home_time_return_due", [], MEMBERS, {}).size).toBe(0);
  });
});

describe("resolveAlertRecipients — the carrier's own routes (D-NR2)", () => {
  it("uses the saved rows INSTEAD of the defaults once there are any", () => {
    const saved = [route("role", "admin", "email")];
    expect(routesInForce("home_time_overdue", saved)).toBe(saved);
    expect(routesInForce("home_time_overdue", [])).toBe(alertDefinition("home_time_overdue").defaults);
    expect(got(resolveAlertRecipients("home_time_overdue", saved, MEMBERS, REL))).toEqual({ [ADA]: ["email"] });
  });

  it("ignores a row that is switched off", () => {
    const saved = [route("role", "dispatcher", "bell"), route("role", "dispatcher", "sms", false)];
    expect(got(resolveAlertRecipients("home_time_overdue", saved, MEMBERS, REL))).toEqual({ [DANA]: ["bell"], [IVO]: ["bell"] });
  });

  it("lets a person's own row win in both directions: added to what their role lacks, removed from what it has", () => {
    const saved = [
      route("role", "dispatcher", "bell"),
      route("role", "dispatcher", "email"),
      route("user", IVO, "email", false), // Ivo does not want the email his role gets
      route("user", ADA, "sms"), // the admin wants a text no role row gives her
    ];
    expect(got(resolveAlertRecipients("home_time_overdue", saved, MEMBERS, REL))).toEqual({
      [DANA]: ["bell", "email"],
      [IVO]: ["bell"],
      [ADA]: ["sms"],
    });
  });

  it("drops a person whose every channel was switched off", () => {
    const saved = [route("relation", "marked_by", "bell"), route("user", DANA, "bell", false)];
    expect(resolveAlertRecipients("home_time_overdue", saved, MEMBERS, REL).size).toBe(0);
  });

  it("never reaches somebody who cannot view the section, whatever a row says (Q-NR2)", () => {
    const saved = [route("role", "recruiter", "email"), route("user", REX, "bell"), route("relation", "marked_by", "bell")];
    expect(resolveAlertRecipients("home_time_overdue", saved, MEMBERS, { marked_by: REX }).size).toBe(0);
  });

  it("never reaches an id that is not an active member — a person who left, a relation to a suspended account", () => {
    const saved = [route("user", "u-gone", "email"), route("relation", "truck_dispatcher", "bell")];
    expect(resolveAlertRecipients("home_time_overdue", saved, MEMBERS, { truck_dispatcher: "u-suspended" }).size).toBe(0);
  });

  it("reaches nobody through a relation the catalogue does not know", () => {
    expect(resolveAlertRecipients("home_time_overdue", [route("relation", "the_owner", "bell")], MEMBERS, REL).size).toBe(0);
  });
});

describe("homeTimeAlertsDue (D-HT12)", () => {
  const NOW = new Date("2026-11-13T15:00:00Z");
  const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000).toISOString();
  const period = (o: Partial<Parameters<typeof homeTimeAlertsDue>[0]> = {}) => ({
    id: "p1", startAt: hours(-48), expectedReturnAt: hours(72), endAt: null, canceledAt: null, disposition: "with_driver" as const, ...o,
  });
  const kinds = (p: ReturnType<typeof period>, at = NOW, s = HOME_TIME_DEFAULTS) => homeTimeAlertsDue(p, s, at).map((a) => a.kind);
  const key = (p: ReturnType<typeof period>, kind: HomeTimeAlertKind, at = NOW) => homeTimeAlertsDue(p, HOME_TIME_DEFAULTS, at).find((a) => a.kind === kind)?.dedupeKey;

  it("says nothing about a period that is far from its return, scheduled, ended or canceled", () => {
    expect(kinds(period())).toEqual([]);
    expect(kinds(period({ startAt: hours(5), expectedReturnAt: hours(10) }))).toEqual([]);
    expect(kinds(period({ expectedReturnAt: hours(-50), endAt: hours(-40) }))).toEqual([]);
    expect(kinds(period({ expectedReturnAt: hours(-50), canceledAt: hours(-40) }))).toEqual([]);
  });

  it("warns that home time is ending inside the carrier's window, to the hour", () => {
    expect(kinds(period({ expectedReturnAt: hours(25) }))).toEqual([]);
    expect(kinds(period({ expectedReturnAt: hours(24) }))).toEqual(["home_time_return_due"]);
    expect(kinds(period({ expectedReturnAt: hours(1) }))).toEqual(["home_time_return_due"]);
  });

  it("waits the carrier's grace after the return before calling it overstayed", () => {
    expect(kinds(period({ expectedReturnAt: hours(-1) }))).toEqual([]);
    expect(kinds(period({ expectedReturnAt: hours(-2) }))).toEqual(["home_time_overdue"]);
  });

  it("repeats the overstay daily with its own key each day, seven times, then stops", () => {
    const p = period({ expectedReturnAt: hours(-2) });
    const at = (days: number) => new Date(NOW.getTime() + days * 86_400_000);
    const repeats = [0, 0.9, 1, 6].map((d) => homeTimeAlertsDue(p, HOME_TIME_DEFAULTS, at(d)).find((a) => a.kind === "home_time_overdue")?.repeat);
    expect(repeats).toEqual([1, 1, 2, 7]);
    expect(new Set([0, 1, 2, 3, 4, 5, 6].map((d) => key(p, "home_time_overdue", at(d)))).size).toBe(HOME_TIME_OVERDUE_REPEATS);
    expect(kinds(p, at(7)).includes("home_time_overdue")).toBe(false);
  });

  it("re-arms 'ending' and 'overstayed' when the return time changes, and not when a job retries", () => {
    const a = period({ expectedReturnAt: hours(10) });
    expect(key(a, "home_time_return_due")).toBe(key({ ...a }, "home_time_return_due", new Date(NOW.getTime() + 60_000)));
    expect(key(a, "home_time_return_due")).not.toBe(key(period({ expectedReturnAt: hours(20) }), "home_time_return_due"));
    // The same instant spelled two ways is one key.
    expect(key(period({ expectedReturnAt: "2026-11-13T20:00:00Z" }), "home_time_return_due")).toBe(key(period({ expectedReturnAt: "2026-11-13T14:00:00-06:00" }), "home_time_return_due"));
  });

  it("says a truck has been home too long once, whatever happens to the return time, and only when it is with the driver", () => {
    const old = period({ startAt: hours(-8 * 24), expectedReturnAt: hours(72) });
    expect(kinds(old)).toEqual(["home_time_truck_limit"]);
    expect(key(old, "home_time_truck_limit")).toBe(key({ ...old, expectedReturnAt: hours(200) }, "home_time_truck_limit"));
    expect(kinds({ ...old, startAt: hours(-8 * 24 + 1) })).toEqual([]);
    expect(kinds({ ...old, disposition: "at_yard" })).toEqual([]);
    expect(kinds({ ...old, disposition: "no_truck" })).toEqual([]);
  });

  it("can say two things at once: overstayed, and the truck too long", () => {
    expect(kinds(period({ startAt: hours(-9 * 24), expectedReturnAt: hours(-5) }))).toEqual(["home_time_overdue", "home_time_truck_limit"]);
  });

  it("uses the carrier's own thresholds", () => {
    const own = { returnDueHours: 48, overdueAfterHours: 0, truckLimitDays: 2 };
    expect(kinds(period({ expectedReturnAt: hours(40) }), NOW, own)).toEqual(["home_time_return_due", "home_time_truck_limit"]);
    expect(kinds(period({ startAt: hours(-10), expectedReturnAt: hours(-0.01) }), NOW, own)).toEqual(["home_time_overdue"]);
  });

  it("words each alert with the driver, the truck and the carrier's reading of the return", () => {
    const p = { driverName: "Marcus Hill", unitNumber: "702", startAt: hours(-9 * 24), expectedReturnAt: hours(-5) };
    expect(homeTimeAlertLine({ kind: "home_time_return_due" }, p, NOW, "11/14/2026 8:00 AM")).toBe("Marcus Hill (truck 702) is due back from home time 11/14/2026 8:00 AM");
    expect(homeTimeAlertLine({ kind: "home_time_overdue" }, p, NOW, "11/13/2026 4:00 AM")).toBe("Marcus Hill (truck 702) is past his home-time return of 11/13/2026 4:00 AM and is not marked back");
    expect(homeTimeAlertLine({ kind: "home_time_truck_limit" }, p, NOW, "")).toBe("Truck 702 has been at Marcus Hill's home for 9 days");
    expect(homeTimeAlertLine({ kind: "home_time_overdue" }, { ...p, unitNumber: null }, NOW, "11/13/2026 4:00 AM")).toBe("Marcus Hill is past his home-time return of 11/13/2026 4:00 AM and is not marked back");
  });
});
