import { describe, expect, it } from "vitest";
import { MODULE_KEYS, type ModuleSet } from "./entitlements.js";
import { ASSISTANT_VIEWS, assistantViewsFor, parseAssistantViewFilters } from "./assistantViews.js";
import { splitAssistantLink, assistantAnswerPages } from "./assistantContract.js";
import { FUEL_PROBLEMS_QUERY_KEYS, fuelProblemsToQuery } from "./fuelProblemsLinkContract.js";
import { FUEL_COSTS_QUERY_KEYS } from "./fuelCostsLinkContract.js";
import { DRIVERS_QUERY_KEYS, driversToQuery } from "./driversLinkContract.js";
import { FUEL_CARDS_QUERY_KEYS, fuelCardsToQuery } from "./fuelCardsLinkContract.js";
import { FUEL_ALERTS_QUERY_KEYS, fuelAlertsToQuery } from "./fuelAlertsLinkContract.js";
import { FUEL_LOG_FACET_TABS, FUEL_LOG_QUERY_KEYS, fuelLogToQuery } from "./fuelLogLinkContract.js";
import { SURFACES } from "./surfaceCatalogue.js";

const ALL: ModuleSet = new Set(MODULE_KEYS);

describe("open_view's pages (F21 Step 5)", () => {
  it("refuses a filter the page does not have, naming what it can filter by, rather than dropping it", () => {
    const r = parseAssistantViewFilters("fuel_problems", { states: ["open"], units: ["718"], amount_over: 200 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/cannot filter by amount_over/);
    expect(!r.ok && r.error).toMatch(/It can filter by: states, kinds, units, from, to, mine/);
    // A value outside the page's own list is refused too.
    expect(parseAssistantViewFilters("fuel_problems", { states: ["disputed"] }).ok).toBe(false);
    expect(parseAssistantViewFilters("fuel_problems", { states: ["open"], units: ["718"] })).toEqual({ ok: true, filters: { states: ["open"], units: ["718"] } });
  });

  it("offers a page by its own surface gate: fuel's queue to whoever views fuel, never to a technician or a driver", () => {
    expect(assistantViewsFor("admin", null, ALL)).toEqual(["fuel_problems", "fuel_log", "fuel_alerts", "fuel_cards", "drivers"]);
    // The roster is `roster`'s page: the recruiter views it (the matrix), and nothing fuel.
    expect(assistantViewsFor("recruiter", null, ALL)).toEqual(["drivers"]);
    // Fuel alerts is `safety`'s page: a safety manager is offered it beside the fuel pages they view.
    expect(assistantViewsFor("safety_manager", null, ALL)).toContain("fuel_alerts");
    expect(assistantViewsFor("technician", null, ALL)).toEqual([]);
    expect(assistantViewsFor("driver", null, ALL)).toEqual([]);
    // Every view names a real surface.
    for (const v of Object.values(ASSISTANT_VIEWS)) expect(SURFACES.some((s) => s.key === v.surfaceKey), v.surfaceKey).toBe(true);
  });

  it("writes the page's own keys: the spend window and trucks as Fuel costs spells them, state and kind as the queue reads them", () => {
    expect(FUEL_PROBLEMS_QUERY_KEYS.trucks).toBe(FUEL_COSTS_QUERY_KEYS.trucks);
    expect(fuelProblemsToQuery({ vehicleIds: ["v1", "v2"], states: ["open", "investigating"], kinds: ["card_fraud"], mine: true, from: "2026-10-01" }))
      .toEqual({ trucks: "v1,v2", state: "open,investigating", kind: "card_fraud", owner: "me", from: "2026-10-01" });
    expect(fuelProblemsToQuery({})).toEqual({});
  });

  it("only open_view's link navigates, and only to one of its pages; it is listed under the answer", () => {
    const link = { surfaceKey: "fuel.exceptions", query: { state: "open" } };
    expect(splitAssistantLink("open_view", { opened: "Fuel problems", link }).link).toEqual({ ...link, navigate: true });
    // Pointed anywhere but a view's page: dropped.
    expect(splitAssistantLink("open_view", { link: { surfaceKey: "settings", query: {} } }).link).toBeNull();
    // Another tool's link never navigates, even if its result claims to.
    expect(splitAssistantLink("fuel_report", { link: { surfaceKey: "fuel.spend", query: {}, navigate: true } }).link).toEqual({ surfaceKey: "fuel.spend", query: {} });
    expect(assistantAnswerPages([{ name: "open_view" }], [{ ...link, navigate: true }])).toEqual(["fuel.exceptions"]);
  });

  it("Fuel log: a tab's own facet is refused on another tab, naming the tab that has it, never moved there", () => {
    expect(parseAssistantViewFilters("fuel_log", { tab: "declines", risk: "alert", state: "TX", units: ["718"], from: "2026-11-01" }).ok).toBe(true);
    const risk = parseAssistantViewFilters("fuel_log", { risk: "alert" });
    expect(!risk.ok && risk.error).toMatch(/risk: only the declines tab has this filter, not fills/);
    const tank = parseAssistantViewFilters("fuel_log", { tab: "source", tank: "reefer" });
    expect(!tank.ok && tank.error).toMatch(/tank: only the fills tab has this filter, not source/);
    expect(parseAssistantViewFilters("fuel_log", { tab: "source", state: "TX" }).ok).toBe(true);
    // Outside the page's own lists, or a filter it does not have: refused.
    expect(parseAssistantViewFilters("fuel_log", { tab: "declines", risk: "high" }).ok).toBe(false);
    expect(parseAssistantViewFilters("fuel_log", { tab: "declines", state: "Texas" }).ok).toBe(false);
    const driver = parseAssistantViewFilters("fuel_log", { driver: "Ana Diaz" });
    expect(!driver.ok && driver.error).toMatch(/cannot filter by driver.*It can filter by: tab, units, from, to, tank, risk, state/);
  });

  it("Fuel log: writes the page's own keys, trucks as unit numbers under `unit`, the default tab left out", () => {
    expect(FUEL_LOG_QUERY_KEYS.units).toBe("unit");
    expect(fuelLogToQuery({ tab: "declines", units: ["718", "751"], risk: "alert", state: "TX", from: "2026-11-01", to: "2026-11-07" }))
      .toEqual({ tab: "declines", unit: "718,751", risk: "alert", state: "TX", from: "2026-11-01", to: "2026-11-07" });
    expect(fuelLogToQuery({ tab: "fills", tank: "reefer" })).toEqual({ tank: "reefer" });
    // Every facet a link may set is owned by at least one real tab.
    for (const owners of Object.values(FUEL_LOG_FACET_TABS)) expect(owners.length).toBeGreaterThan(0);
  });

  it("Fuel alerts: one status (or `all`) and one severity, as the page's single-choice controls; two severities are refused", () => {
    expect(parseAssistantViewFilters("fuel_alerts", { status: "all", severity: "critical", units: ["718"], reefer: true }).ok).toBe(true);
    const two = parseAssistantViewFilters("fuel_alerts", { severity: ["high", "critical"] });
    expect(two.ok).toBe(false);
    expect(parseAssistantViewFilters("fuel_alerts", { status: "superseded" }).ok).toBe(false);
    const amount = parseAssistantViewFilters("fuel_alerts", { amount_over: 200 });
    expect(!amount.ok && amount.error).toMatch(/cannot filter by amount_over.*It can filter by: status, severity, units, from, to, reefer/);
  });

  it("Fuel alerts: writes the page's own keys, trucks as vehicle ids under `vehicle`, every status as `all`, never as absence", () => {
    expect(FUEL_ALERTS_QUERY_KEYS.vehicles).toBe("vehicle");
    expect(fuelAlertsToQuery({ vehicleIds: ["v1", "v2"], status: "all", severity: "high", reeferOnly: true, from: "2026-11-01" }))
      .toEqual({ vehicle: "v1,v2", status: "all", severity: "high", reefer: "1", from: "2026-11-01" });
    expect(fuelAlertsToQuery({})).toEqual({});
  });

  it("Fuel cards: one value per filter, as the page's single-choice controls; the card's driver name is not a link filter", () => {
    expect(parseAssistantViewFilters("fuel_cards", { status: "Hold", unit: "718", override: "active", linked: "unlinked", health: "errors", policy: "3" }).ok).toBe(true);
    expect(parseAssistantViewFilters("fuel_cards", { status: "hold" }).ok).toBe(false);
    expect(parseAssistantViewFilters("fuel_cards", { units: ["718", "751"] }).ok).toBe(false);
    const driver = parseAssistantViewFilters("fuel_cards", { driver: "Ana Diaz" });
    expect(!driver.ok && driver.error).toMatch(/cannot filter by driver.*It can filter by: status, unit, policy, override, linked, health/);
  });

  it("Fuel cards: writes the page's own keys, and the status-only link card_holds already sends is unchanged", () => {
    expect(FUEL_CARDS_QUERY_KEYS).toEqual({ status: "status", unit: "unit", policy: "policy", override: "override", linked: "linked", health: "health" });
    expect(fuelCardsToQuery({ status: "Fraud" })).toEqual({ status: "Fraud" });
    expect(fuelCardsToQuery({ unit: "718", override: "active", health: "errors" })).toEqual({ unit: "718", override: "active", health: "errors" });
  });

  it("Drivers: the roster's own vocabularies, one value each; `any` is every status, and a truck is not a roster filter", () => {
    expect(parseAssistantViewFilters("drivers", { status: "any", file: "expired", due: "30", requirement: "medical_card", unseated: true }).ok).toBe(true);
    expect(parseAssistantViewFilters("drivers", { due: "" }).ok).toBe(false);
    expect(parseAssistantViewFilters("drivers", { requirement: "twic" }).ok).toBe(false);
    const truck = parseAssistantViewFilters("drivers", { units: ["718"] });
    expect(!truck.ok && truck.error).toMatch(/cannot filter by units.*It can filter by: status, file, due, requirement, search, unseated, archived/);
  });

  it("Drivers: writes the roster's own keys; status left out opens its default, `null` writes `any`, and card_holds-era links are unchanged", () => {
    expect(DRIVERS_QUERY_KEYS.search).toBe("q");
    expect(driversToQuery({ due: "30", requirement: "medical_card", unseated: true, archived: true, search: "Diaz" }))
      .toEqual({ due: "30", req: "medical_card", seat: "none", show: "archived", q: "Diaz" });
    expect(driversToQuery({ file: "expired", status: null })).toEqual({ file: "expired", status: "any" });
    expect(driversToQuery({})).toEqual({});
  });
});
