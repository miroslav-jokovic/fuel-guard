import { describe, expect, it } from "vitest";
import { ALERT_CATALOGUE, alertRoutesProblem, type AlertRoute } from "@silvicom/shared";
import { addablePeople, editedChannels, personRow, recipientRows, routesChanged, textHint, toRoutes, type RoutingAlert, type RoutingMember } from "./alertRoutingForm";

const MEMBERS: RoutingMember[] = [
  { userId: "u-ada", name: "Ada Admin", role: "admin", textReady: false },
  { userId: "u-dana", name: "Dana Dispatch", role: "dispatcher", textReady: true },
  { userId: "u-ivo", name: "Ivo K", role: "dispatcher", textReady: false },
  { userId: "u-fran", name: "Fran Fleet", role: "fleet_manager", textReady: true },
];
const def = ALERT_CATALOGUE.find((a) => a.key === "home_time_overdue")!;
const alert = (routes: AlertRoute[] = [...def.defaults], usesDefaults = true): RoutingAlert => ({
  key: def.key,
  label: def.label,
  description: def.description,
  relations: [
    { key: "marked_by", label: "Whoever marked the home time" },
    { key: "truck_dispatcher", label: "The truck's dispatcher" },
  ],
  roles: [
    { key: "admin", label: "Admin" },
    { key: "fleet_manager", label: "Fleet manager" },
    { key: "dispatcher", label: "Dispatcher" },
  ],
  routes,
  usesDefaults,
});
const r = (recipientKind: AlertRoute["recipientKind"], recipientKey: string, channel: AlertRoute["channel"], enabled = true): AlertRoute => ({ recipientKind, recipientKey, channel, enabled });
const switches = (rows: ReturnType<typeof recipientRows>) => Object.fromEntries(rows.map((x) => [x.id, [x.bell, x.email]]));

describe("recipientRows", () => {
  it("lists the two relations, then every role that can receive it, with the defaults' switches and how many people a role is", () => {
    const rows = recipientRows(alert(), MEMBERS);
    expect(rows.map((x) => x.id)).toEqual(["relation:marked_by", "relation:truck_dispatcher", "role:admin", "role:fleet_manager", "role:dispatcher"]);
    expect(switches(rows)).toMatchObject({ "relation:marked_by": [true, false], "role:fleet_manager": [true, true], "role:dispatcher": [false, false] });
    expect(rows.find((x) => x.id === "role:dispatcher")!.hint).toBe("2 people today");
    expect(rows.find((x) => x.id === "role:fleet_manager")!.hint).toBe("1 person today");
  });

  it("adds a row for each person the carrier named, and drops one who is no longer a member", () => {
    const rows = recipientRows(alert([r("role", "fleet_manager", "bell"), r("user", "u-dana", "email"), r("user", "u-gone", "bell")], false), MEMBERS);
    expect(rows.filter((x) => x.kind === "user").map((x) => [x.label, x.bell, x.email])).toEqual([["Dana Dispatch", false, true]]);
  });

  it("reads a saved switch that is off as off", () => {
    expect(switches(recipientRows(alert([r("role", "fleet_manager", "bell"), r("role", "fleet_manager", "email", false)], false), MEMBERS))["role:fleet_manager"]).toEqual([true, false]);
  });
});

describe("toRoutes", () => {
  it("round-trips the defaults into a set the API's own rule accepts, with the same people told", () => {
    const routes = toRoutes(recipientRows(alert(), MEMBERS), def.defaults);
    expect(alertRoutesProblem(def.key, routes, new Set(MEMBERS.map((m) => m.userId)))).toBeNull();
    expect(routes.filter((x) => x.enabled).map((x) => `${x.recipientKey}:${x.channel}`).sort()).toEqual(def.defaults.map((x) => `${x.recipientKey}:${x.channel}`).sort());
  });

  it("on a page with no Text column, carries a text route of a listed recipient through untouched, and lets go of one whose person was taken off", () => {
    const original = [r("role", "fleet_manager", "bell"), r("role", "fleet_manager", "sms"), r("user", "u-dana", "sms"), r("user", "u-dana", "bell")];
    const rows = recipientRows(alert(original, false), MEMBERS).filter((x) => x.id !== "user:u-dana");
    const routes = toRoutes(rows, original, editedChannels(false));
    expect(routes.filter((x) => x.channel === "sms")).toEqual([r("role", "fleet_manager", "sms")]);
    expect(routes.some((x) => x.recipientKey === "u-dana")).toBe(false);
  });

  it("on a page WITH the Text column, sends the Text switch as the page shows it — once, not carried as well", () => {
    const original = [r("role", "fleet_manager", "bell"), r("role", "fleet_manager", "sms")];
    const rows = recipientRows(alert(original, false), MEMBERS).map((x) => (x.id === "role:fleet_manager" ? { ...x, sms: false } : x));
    const routes = toRoutes(rows, original, editedChannels(true));
    expect(routes.filter((x) => x.recipientKey === "fleet_manager" && x.channel === "sms")).toEqual([r("role", "fleet_manager", "sms", false)]);
    expect(alertRoutesProblem(def.key, routes, new Set(MEMBERS.map((m) => m.userId)))).toBeNull();
  });

  it("a set with every switch off is what the API refuses", () => {
    const rows = recipientRows(alert(), MEMBERS).map((x) => ({ ...x, bell: false, email: false }));
    expect(alertRoutesProblem(def.key, toRoutes(rows, []), new Set())).toMatch(/cannot be sent to nobody/);
  });
});

describe("adding a person", () => {
  it("starts on what their role gives them today, so adding somebody takes nothing away", () => {
    const rows = recipientRows(alert(), MEMBERS);
    expect(personRow(def.key, rows, MEMBERS[3]!)).toMatchObject({ id: "user:u-fran", bell: true, email: true });
  });

  it("starts somebody their role does not reach on the dashboard only", () => {
    expect(personRow(def.key, recipientRows(alert(), MEMBERS), MEMBERS[1]!)).toMatchObject({ id: "user:u-dana", bell: true, email: false });
  });

  it("offers only people who are not a row yet", () => {
    const rows = recipientRows(alert([r("role", "fleet_manager", "bell"), r("user", "u-dana", "bell")], false), MEMBERS);
    expect(addablePeople(rows, MEMBERS).map((m) => m.userId)).toEqual(["u-ada", "u-ivo", "u-fran"]);
  });
});

describe("routesChanged", () => {
  it("is false for the server's own rows, and true once a switch moves or a person is added", () => {
    const a = alert();
    const rows = recipientRows(a, MEMBERS);
    expect(routesChanged(rows, a, MEMBERS)).toBe(false);
    expect(routesChanged(rows.map((x) => (x.id === "role:dispatcher" ? { ...x, bell: true } : x)), a, MEMBERS)).toBe(true);
    expect(routesChanged([...rows, personRow(def.key, rows, MEMBERS[1]!)], a, MEMBERS)).toBe(true);
  });
});

describe("who a Text switch really reaches", () => {
  it("says how many of a role confirmed a number, and when a named person has not", () => {
    expect(textHint("role", "dispatcher", MEMBERS)).toBe("1 of 2 confirmed");
    expect(textHint("role", "fleet_manager", MEMBERS)).toBe("1 of 1 confirmed");
    expect(textHint("role", "auditor", MEMBERS)).toBe("");
    expect(textHint("user", "u-ivo", MEMBERS)).toBe("No confirmed number");
    expect(textHint("user", "u-dana", MEMBERS)).toBe("");
    expect(textHint("relation", "marked_by", MEMBERS)).toBe("If they confirmed a number");
  });

  it("reads a saved text route into the row, and counts it as a change when it moves", () => {
    const a = alert([r("role", "fleet_manager", "bell"), r("role", "fleet_manager", "sms")], false);
    const rows = recipientRows(a, MEMBERS);
    expect(rows.find((x) => x.id === "role:fleet_manager")).toMatchObject({ sms: true, textHint: "1 of 1 confirmed" });
    expect(routesChanged(rows.map((x) => ({ ...x, sms: false })), a, MEMBERS)).toBe(true);
  });
});
