import { describe, it, expect } from "vitest";
import { routeFuelSettingsFormSchema, ROUTE_FUEL_SETTINGS_DEFAULTS } from "./settingsSchema.js";

/**
 * The Planned-Fueling form's target fields (C8). Every assertion here is about the empty case, because
 * that is the one a coercing schema gets wrong: `z.coerce.number()` turns "" into 0, and 0 is a LEGAL
 * ceiling — "no gallons at all in an avoided state" is the strictest policy a carrier can hold. A
 * blank field silently committing them to it, and then reporting every gallon as a miss, is the bug.
 */

const form = (o: Record<string, unknown> = {}) => ({ ...ROUTE_FUEL_SETTINGS_DEFAULTS, ...o });
const parse = (o: Record<string, unknown> = {}) => routeFuelSettingsFormSchema.parse(form(o));

describe("the target fields on the Planned Fueling form", () => {
  it("starts blank — the product sets no standard on the carrier's behalf", () => {
    expect(ROUTE_FUEL_SETTINGS_DEFAULTS.target_on_network_pct).toBeNull();
    expect(ROUTE_FUEL_SETTINGS_DEFAULTS.target_discount_capture_pct).toBeNull();
    expect(ROUTE_FUEL_SETTINGS_DEFAULTS.target_avoided_state_gal).toBeNull();
  });

  // The bug this schema exists to avoid.
  it("reads an emptied field as no target, not as a target of zero", () => {
    const parsed = parse({ target_on_network_pct: "", target_avoided_state_gal: "" });
    expect(parsed.target_on_network_pct).toBeNull();
    expect(parsed.target_avoided_state_gal).toBeNull();
  });

  // ...and the other half of it: a deliberate zero must survive, because it is a real policy.
  it("keeps a deliberate zero ceiling, which is the strictest policy and a legal one", () => {
    expect(parse({ target_avoided_state_gal: "0" }).target_avoided_state_gal).toBe(0);
  });

  it("accepts the numbers a text input actually produces", () => {
    const parsed = parse({ target_on_network_pct: "90", target_discount_capture_pct: "75.5" });
    expect(parsed.target_on_network_pct).toBe(90);
    expect(parsed.target_discount_capture_pct).toBe(75.5);
  });

  it("refuses a percentage outside 0-100, which is a typo rather than a policy", () => {
    expect(routeFuelSettingsFormSchema.safeParse(form({ target_on_network_pct: "120" })).success).toBe(false);
    expect(routeFuelSettingsFormSchema.safeParse(form({ target_discount_capture_pct: "-5" })).success).toBe(false);
  });

  it("refuses negative gallons, which is not a ceiling anybody meant", () => {
    expect(routeFuelSettingsFormSchema.safeParse(form({ target_avoided_state_gal: "-1" })).success).toBe(false);
  });
});
