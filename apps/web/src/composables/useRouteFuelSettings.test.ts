import { describe, it, expect } from "vitest";
import { routeFuelSettingsFormSchema, ROUTE_FUEL_SETTINGS_DEFAULTS } from "@silvicom/shared";
import { ROUTE_FUEL_SETTINGS_COLS } from "./useRouteFuelSettings";

/**
 * WHY THIS SUITE EXISTS, and it is a data-loss story rather than a tidiness one.
 *
 * `saveRouteFuelSettings` upserts `{ org_id, ...form }` — the WHOLE form, every time. So any field the
 * READ does not select comes back absent, the form falls back to its default, and the next Save writes
 * that default over whatever was really in the column. Silently, with the page showing a blank field
 * that looks like the truth.
 *
 * That happened: C8 added three target fields and the hand-written column list did not gain them, so
 * for one day the Planned Fueling page would have wiped an owner's targets the first time anybody
 * pressed Save on it. The list is derived from the schema now, and this is the test that says the two
 * cannot drift apart again.
 */
describe("the settings read selects everything the settings write sends", () => {
  const selected = new Set(ROUTE_FUEL_SETTINGS_COLS.split(",").map((c) => c.trim()));

  it("selects every field the form round-trips", () => {
    const missing = Object.keys(routeFuelSettingsFormSchema.shape).filter((k) => !selected.has(k));
    expect(missing, "fields the form saves but the read never loads — a Save would blank them").toEqual([]);
  });

  it("selects nothing the form does not know about, so the upsert cannot carry a stray column", () => {
    const known = new Set(Object.keys(ROUTE_FUEL_SETTINGS_DEFAULTS));
    expect([...selected].filter((c) => !known.has(c))).toEqual([]);
  });

  // The three that were actually missing, named so this reads as a regression test and not a lint.
  it("selects the C8 targets, which is the pair of columns that made this necessary", () => {
    for (const c of ["target_on_network_pct", "target_discount_capture_pct", "target_avoided_state_gal"]) {
      expect(selected.has(c)).toBe(true);
    }
  });
});
