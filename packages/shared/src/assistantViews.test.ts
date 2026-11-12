import { describe, expect, it } from "vitest";
import { MODULE_KEYS, type ModuleSet } from "./entitlements.js";
import { ASSISTANT_VIEWS, assistantViewsFor, parseAssistantViewFilters } from "./assistantViews.js";
import { splitAssistantLink, assistantAnswerPages } from "./assistantContract.js";
import { FUEL_PROBLEMS_QUERY_KEYS, fuelProblemsToQuery } from "./fuelProblemsLinkContract.js";
import { FUEL_COSTS_QUERY_KEYS } from "./fuelCostsLinkContract.js";
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
    expect(assistantViewsFor("admin", null, ALL)).toEqual(["fuel_problems"]);
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
});
