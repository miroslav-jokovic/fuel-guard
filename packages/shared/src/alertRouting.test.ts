import { describe, expect, it } from "vitest";
import {
  ALERT_CATALOGUE,
  ALERT_KEYS,
  alertDefinition,
  alertMemberCanManage,
  alertMemberCanView,
  alertMemberSections,
  alertRolesFor,
  alertRoutesProblem,
  alertsForMember,
  isAlertKey,
  receivableRoutes,
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

describe("what the Settings page may save (HT5)", () => {
  const members = new Set(["u-fm", "u-disp"]);
  const ROLES = new Set<string>(rolesThatCanView("dispatch"));
  const r = (recipientKind: AlertRoute["recipientKind"], recipientKey: string, channel: AlertRoute["channel"], enabled = true): AlertRoute => ({ recipientKind, recipientKey, channel, enabled });

  it("accepts the catalogue's own defaults for every alert", () => {
    for (const a of ALERT_CATALOGUE) expect(alertRoutesProblem(a.key, a.defaults, members, ROLES), a.key).toBeNull();
  });

  it("refuses a set that reaches nobody — every switch off, or no switch at all", () => {
    expect(alertRoutesProblem("home_time_overdue", [], members, ROLES)).toMatch(/cannot be sent to nobody/);
    expect(alertRoutesProblem("home_time_overdue", [r("role", "fleet_manager", "bell", false)], members, ROLES)).toMatch(/cannot be sent to nobody/);
  });

  it("refuses the same recipient and channel twice, even with different switches", () => {
    expect(alertRoutesProblem("home_time_overdue", [r("role", "fleet_manager", "bell"), r("role", "fleet_manager", "bell", false)], members, ROLES)).toMatch(/twice/);
    expect(alertRoutesProblem("home_time_overdue", [r("role", "fleet_manager", "bell"), r("role", "fleet_manager", "email")], members, ROLES)).toBeNull();
  });

  it("refuses a role that cannot view the alert's section, a relation the alert does not have, and a person who is not a member", () => {
    expect(alertRoutesProblem("home_time_overdue", [r("role", "driver", "bell")], members, ROLES)).toMatch(/role cannot open/);
    expect(alertRoutesProblem("home_time_overdue", [r("relation", "the_owner", "bell")], members, ROLES)).toMatch(/does not have that recipient/);
    expect(alertRoutesProblem("home_time_overdue", [r("user", "u-gone", "bell")], members, ROLES)).toMatch(/not an active member/);
    expect(alertRoutesProblem("home_time_overdue", [r("user", "u-fm", "bell")], members, ROLES)).toBeNull();
  });
});

describe("what one member receives (My alerts)", () => {
  const fm: AlertMember = { userId: "u-fm", role: "fleet_manager" };
  const disp: AlertMember = { userId: "u-disp", role: "dispatcher" };

  it("on the defaults: a fleet manager always hears an overstay by dashboard and email; a dispatcher only when it is theirs", () => {
    expect(alertsForMember("home_time_overdue", [], fm)).toEqual({ always: ["bell", "email"], whenMine: [] });
    expect(alertsForMember("home_time_overdue", [], disp)).toEqual({
      always: [],
      whenMine: [
        { relation: "marked_by", channels: ["bell"] },
        { relation: "truck_dispatcher", channels: ["bell"] },
      ],
    });
  });

  it("a person's own switch off removes what their role gives, and a relation never repeats a channel they always get", () => {
    const saved: AlertRoute[] = [
      { recipientKind: "role", recipientKey: "fleet_manager", channel: "bell", enabled: true },
      { recipientKind: "role", recipientKey: "fleet_manager", channel: "email", enabled: true },
      { recipientKind: "relation", recipientKey: "marked_by", channel: "bell", enabled: true },
      { recipientKind: "relation", recipientKey: "marked_by", channel: "email", enabled: true },
      { recipientKind: "user", recipientKey: "u-fm", channel: "email", enabled: false },
    ];
    // His own "no email" wins over the role AND over the relation.
    expect(alertsForMember("home_time_overdue", saved, fm)).toEqual({ always: ["bell"], whenMine: [] });
    expect(alertsForMember("home_time_overdue", saved, disp)).toEqual({ always: [], whenMine: [{ relation: "marked_by", channels: ["bell", "email"] }] });
  });

  it("says nothing to somebody whose role cannot view the alert's section", () => {
    expect(alertsForMember("home_time_overdue", [{ recipientKind: "user", recipientKey: "u-d", channel: "bell", enabled: true }], { userId: "u-d", role: "driver" })).toEqual({ always: [], whenMine: [] });
  });
});

describe("alerts follow the carrier's Permissions page (Q-HT8)", () => {
  // Production, 2026-11-13: Dispatch taken from the Fleet Manager role — the role every overstay
  // escalates to by default.
  const NO_DISPATCH = { fleet_manager: { dispatch: "none" } } as const;
  const member = (userId: string, role: AlertMember["role"], roleOverrides: Parameters<typeof alertMemberSections>[1] = {}, own?: Parameters<typeof alertMemberSections>[2]): AlertMember => ({
    userId,
    role,
    sections: alertMemberSections(role, roleOverrides, own),
  });
  const told = (members: AlertMember[], relations: Parameters<typeof resolveAlertRecipients>[3] = {}) => [...resolveAlertRecipients("home_time_overdue", [], members, relations).keys()].sort();

  it("does not tell a role the carrier took the section from, though the default route names it", () => {
    expect(told([member(FRAN, "fleet_manager"), member(DANA, "dispatcher")])).toEqual([FRAN]);
    expect(told([member(FRAN, "fleet_manager", NO_DISPATCH), member(DANA, "dispatcher", NO_DISPATCH)])).toEqual([]);
  });

  it("does not tell that person by name or as whoever marked it either", () => {
    const fran = member(FRAN, "fleet_manager", NO_DISPATCH);
    expect(told([fran], { marked_by: FRAN })).toEqual([]);
    expect([...resolveAlertRecipients("home_time_overdue", [{ recipientKind: "user", recipientKey: FRAN, channel: "bell", enabled: true }], [fran], {}).keys()]).toEqual([]);
  });

  it("a person's own access wins over their role's, both ways", () => {
    // Given Dispatch back by name while the role has none: told through the role's route.
    expect(told([member(FRAN, "fleet_manager", NO_DISPATCH, { dispatch: "view" })])).toEqual([FRAN]);
    // Taken from one fleet manager while the role keeps it.
    expect(told([member(FRAN, "fleet_manager", {}, { dispatch: "none" })])).toEqual([]);
  });

  it("tells a role the carrier GAVE the section to, when a route names it", () => {
    const route = [{ recipientKind: "role" as const, recipientKey: "recruiter", channel: "bell" as const, enabled: true }];
    const rex = member(REX, "recruiter", { recruiter: { dispatch: "view" } });
    expect(alertMemberCanView(rex, "dispatch")).toBe(true);
    expect([...resolveAlertRecipients("home_time_overdue", route, [rex], {}).keys()]).toEqual([REX]);
    // Without the carrier's change the same route reaches nobody.
    expect([...resolveAlertRecipients("home_time_overdue", route, [member(REX, "recruiter")], {}).keys()]).toEqual([]);
  });

  it("never lets a saved row narrow or widen an admin or a driver: their access is not editable", () => {
    expect(alertMemberSections("admin", { admin: { dispatch: "none" } } as never, { dispatch: "none" })).toEqual({});
    expect(alertMemberCanView(member(ADA, "admin", { admin: { dispatch: "none" } } as never, { dispatch: "none" }), "dispatch")).toBe(true);
    expect(alertMemberCanView({ userId: "u-d", role: "driver", sections: alertMemberSections("driver", {}, { dispatch: "manage" }) }, "dispatch")).toBe(false);
  });

  it("lists the roles that can receive: the shipped ones less those taken away, plus those given", () => {
    expect(alertRolesFor("dispatch", {})).toEqual(rolesThatCanView("dispatch"));
    expect(alertRolesFor("dispatch", NO_DISPATCH)).not.toContain("fleet_manager");
    expect(alertRolesFor("dispatch", NO_DISPATCH)).toContain("dispatcher");
    expect(alertRolesFor("dispatch", { recruiter: { dispatch: "view" } })).toContain("recruiter");
  });

  it("falls back only to people who MANAGE the section on the carrier's answer", () => {
    expect(alertMemberCanManage(member(FRAN, "fleet_manager"), "dispatch")).toBe(true);
    expect(alertMemberCanManage(member(FRAN, "fleet_manager", NO_DISPATCH), "dispatch")).toBe(false);
    expect(alertMemberCanManage(member(FRAN, "fleet_manager", { fleet_manager: { dispatch: "view" } }), "dispatch")).toBe(false);
  });

  it("the save rule refuses a role that can no longer receive it, and the page is shown the set without it", () => {
    const roles = new Set<string>(alertRolesFor("dispatch", NO_DISPATCH));
    const defaults = alertDefinition("home_time_overdue").defaults;
    expect(alertRoutesProblem("home_time_overdue", defaults, new Set(), roles)).toMatch(/role cannot open/);
    const shown = receivableRoutes(defaults, new Set(), roles);
    expect(shown.some((r) => r.recipientKey === "fleet_manager")).toBe(false);
    expect(shown.filter((r) => r.recipientKind === "relation")).toHaveLength(2);
    expect(alertRoutesProblem("home_time_overdue", shown, new Set(), roles)).toBeNull();
    // …and a person who left is dropped the same way.
    expect(receivableRoutes([{ recipientKind: "user", recipientKey: "u-gone", channel: "bell", enabled: true }], new Set(["u-here"]), roles)).toEqual([]);
  });

  it("what one member receives is the same answer: nothing for somebody the carrier took the section from", () => {
    expect(alertsForMember("home_time_overdue", [], member(FRAN, "fleet_manager", NO_DISPATCH))).toEqual({ always: [], whenMine: [] });
  });
});
