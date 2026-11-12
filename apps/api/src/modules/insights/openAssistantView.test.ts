import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { openAssistantView } from "./openAssistantView.js";

/** `open_view` (F21 Step 5): the model's filters become the page's link, through its contract. */
const ORG = "org-1";
const rec = () =>
  createSupabaseRecorder({
    tables: {
      vehicles: [
        { id: "v718", unit_number: "718", org_id: ORG },
        { id: "v751", unit_number: "751", org_id: ORG },
      ],
    },
  });

describe("openAssistantView", () => {
  it("opens Fuel problems on the asked trucks and states, as the page reads them; unit numbers become ids only in the link", async () => {
    const r = rec();
    const out = (await openAssistantView(r.client, ORG, { view: "fuel_problems", filters: { states: ["open"], units: ["718"] } }, ["fuel_problems"])) as Record<string, unknown>;
    expect(out).toEqual({
      opened: "Fuel problems",
      filters: { states: ["open"], units: ["718"] },
      link: { surfaceKey: "fuel.exceptions", query: { state: "open", trucks: "v718" } },
    });
    expectOrgScoped(r, ORG);
  });

  it("refuses a filter the page lacks, a truck not in the fleet, and a page outside the caller's own, opening nothing", async () => {
    const r = rec();
    const amount = (await openAssistantView(r.client, ORG, { view: "fuel_problems", filters: { amount_over: 200 } }, ["fuel_problems"])) as { error: string; link?: unknown };
    expect(amount.error).toMatch(/cannot filter by amount_over/);
    expect(amount.link).toBeUndefined();
    const missing = (await openAssistantView(r.client, ORG, { view: "fuel_problems", filters: { units: ["718", "999"] } }, ["fuel_problems"])) as { error: string };
    expect(missing.error).toBe("Not in this fleet: 999. Nothing was opened.");
    const denied = (await openAssistantView(r.client, ORG, { view: "fuel_problems", filters: {} }, [])) as { error: string };
    expect(denied.error).toMatch(/not available with this person's access/);
  });

  it("opens the Fuel log's declines on the asked trucks, writing each unit as the fleet spells it, never an id", async () => {
    const r = rec();
    const out = (await openAssistantView(
      r.client,
      ORG,
      { view: "fuel_log", filters: { tab: "declines", units: ["#718", "Unit 751"], risk: "alert", from: "2026-11-05", to: "2026-11-11" } },
      ["fuel_problems", "fuel_log"],
    )) as Record<string, unknown>;
    expect(out).toEqual({
      opened: "Fuel log",
      filters: { tab: "declines", units: ["#718", "Unit 751"], risk: "alert", from: "2026-11-05", to: "2026-11-11" },
      link: { surfaceKey: "fuel.log", query: { tab: "declines", unit: "718,751", risk: "alert", from: "2026-11-05", to: "2026-11-11" } },
    });
    expectOrgScoped(r, ORG);
    const wrongTab = (await openAssistantView(r.client, ORG, { view: "fuel_log", filters: { risk: "alert" } }, ["fuel_log"])) as { error: string; link?: unknown };
    expect(wrongTab.error).toMatch(/only the declines tab has this filter/);
    expect(wrongTab.link).toBeUndefined();
    const missing = (await openAssistantView(r.client, ORG, { view: "fuel_log", filters: { units: ["999"] } }, ["fuel_log"])) as { error: string };
    expect(missing.error).toBe("Not in this fleet: 999. Nothing was opened.");
  });

  it("opens Fuel alerts on the asked trucks as vehicle ids, the severity and status as the page reads them", async () => {
    const r = rec();
    const out = (await openAssistantView(
      r.client,
      ORG,
      { view: "fuel_alerts", filters: { units: ["718"], severity: "critical", status: "all", reefer: true } },
      ["fuel_alerts"],
    )) as Record<string, unknown>;
    expect(out).toEqual({
      opened: "Fuel alerts",
      filters: { units: ["718"], severity: "critical", status: "all", reefer: true },
      link: { surfaceKey: "safety.alerts", query: { vehicle: "v718", severity: "critical", status: "all", reefer: "1" } },
    });
    expectOrgScoped(r, ORG);
    const two = (await openAssistantView(r.client, ORG, { view: "fuel_alerts", filters: { severity: ["high", "critical"] } }, ["fuel_alerts"])) as { error: string; link?: unknown };
    expect(two.error).toMatch(/severity/);
    expect(two.link).toBeUndefined();
  });

  it("opens Fuel cards on ONE truck as the fleet spells its unit, with the page's own facets", async () => {
    const r = rec();
    const out = (await openAssistantView(r.client, ORG, { view: "fuel_cards", filters: { unit: "Unit 718", status: "Hold" } }, ["fuel_cards"])) as Record<string, unknown>;
    expect(out).toEqual({
      opened: "Fuel cards",
      filters: { unit: "Unit 718", status: "Hold" },
      link: { surfaceKey: "fuel.cards", query: { status: "Hold", unit: "718" } },
    });
    expectOrgScoped(r, ORG);
    const missing = (await openAssistantView(r.client, ORG, { view: "fuel_cards", filters: { unit: "999" } }, ["fuel_cards"])) as { error: string };
    expect(missing.error).toBe("Not in this fleet: 999. Nothing was opened.");
  });

  it("opens the Drivers roster with the qualification filters as the roster reads them, `any` for every status", async () => {
    const r = rec();
    const out = (await openAssistantView(r.client, ORG, { view: "drivers", filters: { status: "any", due: "30", requirement: "medical_card" } }, ["drivers"])) as Record<string, unknown>;
    expect(out).toEqual({
      opened: "Drivers",
      filters: { status: "any", due: "30", requirement: "medical_card" },
      link: { surfaceKey: "fleet.drivers", query: { status: "any", due: "30", req: "medical_card" } },
    });
    // No trucks named, so nothing was read at all.
    expect(r.queries.length).toBe(0);
  });
});
