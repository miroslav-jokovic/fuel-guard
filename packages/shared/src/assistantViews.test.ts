import { describe, expect, it } from "vitest";
import { MODULE_KEYS, type ModuleSet } from "./entitlements.js";
import { ASSISTANT_VIEWS, assistantViewsFor, parseAssistantViewFilters } from "./assistantViews.js";
import { splitAssistantLink, assistantAnswerPages } from "./assistantContract.js";
import { FUEL_PROBLEMS_QUERY_KEYS, fuelProblemsToQuery } from "./fuelProblemsLinkContract.js";
import { FUEL_COSTS_QUERY_KEYS } from "./fuelCostsLinkContract.js";
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
    expect(assistantViewsFor("admin", null, ALL)).toEqual(["fuel_problems", "fuel_log"]);
    expect(assistantViewsFor("dispatcher", null, ALL)).toEqual(["fuel_problems", "fuel_log"]);
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
});
