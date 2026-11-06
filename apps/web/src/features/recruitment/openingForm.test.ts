import { describe, expect, it } from "vitest";
import { HIRING_PROFILE_V1, type HiringProfileView, type OpeningView } from "@silvicom/shared";
import { blankOpeningForm, openingFormFrom, openingSaveFrom, statusMovesFrom, type OpeningForm } from "./openingForm";
import { profileOptions, requirementFacts } from "./hiringProfileStep";

/** What the Openings editor sends (Q-AD43 (b)), judged by `openingSaveSchema` as the API judges it. */

const PV = "70000000-0000-4000-8000-000000000001";
const OPENING = "60000000-0000-4000-8000-000000000001";

const filled = (over: Partial<OpeningForm> = {}): OpeningForm => ({
  ...blankOpeningForm(),
  profile_version_id: PV, title: "Class A regional", headcount: "3", pay_per: "mile", pay_min: "0.62", pay_max: "0.70",
  home_time: "Home weekly", equipment: ["dry_van"], area_label: "Joliet, IL", area_point: { latitude: 41.525, longitude: -88.0817 },
  radius_miles: "50", area_reason: "Home weekly from the Joliet yard",
  ...over,
});

describe("openingSaveFrom", () => {
  it("sends pay typed in dollars as cents, and empty optional fields as null", () => {
    const ask = openingSaveFrom(filled({ pay_max: "", headcount: "" }), null);
    expect(ask).toEqual({
      ok: true,
      save: {
        opening_id: null, profile_version_id: PV, title: "Class A regional", headcount: null,
        facts: { pay: { per: "mile", min_cents: 62, max_cents: null }, home_time: "Home weekly", equipment: ["dry_van"], lanes: null, start_date: null },
        area: { label: "Joliet, IL", latitude: 41.525, longitude: -88.0817, radius_miles: 50, reason: "Home weekly from the Joliet yard" },
      },
    });
  });
  it("refuses an area that was not picked from the search", () => {
    expect(openingSaveFrom(filled({ area_point: null }), null)).toEqual({ ok: false, message: "Area: pick the yard or town from the search." });
  });
  it("names the field the contract refused: a radius under the 15-mile floor", () => {
    const ask = openingSaveFrom(filled({ radius_miles: "10" }), null);
    expect(ask.ok ? "" : ask.message.split(":")[0]).toBe("Radius");
  });
  it("says so when the top of the pay range is below its bottom, in the contract's words", () => {
    expect(openingSaveFrom(filled({ pay_min: "0.70", pay_max: "0.62" }), null)).toEqual({ ok: false, message: "Pay up to: The top of the pay range is below its bottom." });
  });
  it("a saved opening's newest version comes back as the same save, for its next version", () => {
    const first = openingSaveFrom(filled({ lanes: "Midwest", start_date: "2026-12-01" }), OPENING);
    if (!first.ok) throw new Error(first.message);
    const s = first.save;
    const view: OpeningView = {
      id: OPENING, status: "open", created_at: "2026-11-06T00:00:00Z",
      current: {
        id: "ov1", version: 1, profile_version_id: s.profile_version_id, title: s.title, facts: s.facts, headcount: s.headcount,
        area_label: s.area.label, area_latitude: s.area.latitude, area_longitude: s.area.longitude, area_radius_miles: s.area.radius_miles,
        area_reason: s.area.reason, created_by_name: "Dana", created_at: "2026-11-06T00:00:00Z",
      },
    };
    expect(openingSaveFrom(openingFormFrom(view), OPENING)).toEqual(first);
  });
  it("offers every status but the one an opening is in", () => {
    expect(statusMovesFrom("open")).toEqual(["paused", "filled", "closed"]);
  });
});

describe("the hiring-profile step", () => {
  const profile = (over: Partial<HiringProfileView>): HiringProfileView => ({
    id: "p1", name: "Class A regional", archived_at: null, created_at: "2026-11-06T00:00:00Z",
    current: { id: PV, version: 2, requirements: HIRING_PROFILE_V1, created_by_name: "Dana", created_at: "2026-11-06T00:00:00Z" }, ...over,
  });
  it("offers each live profile's newest version, never an archived one or one with no version", () => {
    expect(profileOptions([profile({}), profile({ id: "p2", archived_at: "2026-11-06T00:00:00Z" }), profile({ id: "p3", current: null })]))
      .toEqual([{ value: PV, label: "Class A regional · version 2" }]);
  });
  it("shows the requirements it was given, not a copy of the owner's v1", () => {
    const facts = requirementFacts({ ...HIRING_PROFILE_V1, min_age: { years: 25, reason: "Insurer's floor." } });
    expect(facts.find((f) => f.key === "min_age")?.value).toBe("25 · Insurer's floor.");
  });
});
