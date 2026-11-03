import { describe, expect, it } from "vitest";
import { platformLeadSchema, type PlatformLead } from "../../ads/contracts.js";
import { normalisePhone } from "../../smsConsentContract.js";
import { leadFromPlatform, leadProjectionSchema, normaliseEmail, OPENING_BRIEF_SOURCE } from "./leadContract.js";
import { openingSaveSchema, openingVersionRow } from "./opening.js";

const OPENING = "6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a6b";
const CAMPAIGN = "0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d";
const lead = (answers: Record<string, string>, extra: Partial<PlatformLead> = {}): PlatformLead => platformLeadSchema.parse({
  provider: "meta", platform_lead_ref: "123456789", campaign_id: CAMPAIGN, brief_source: OPENING_BRIEF_SOURCE,
  brief_ref: OPENING, created_at: "2026-11-03T14:00:00+00:00", answers, raw: { id: "123456789" }, ...extra,
});

describe("leadFromPlatform — what LeadSink.accept stores", () => {
  const p = leadFromPlatform(lead({ full_name: "  Ray   Driver ", phone_number: "(708) 236-5732", email: " Ray@Example.COM " }));

  it("keeps the platform's own id as the idempotency ref, and the campaign as attribution", () => {
    expect([p.channel, p.external_ref, p.campaign_ref, p.source]).toEqual(["meta", "123456789", CAMPAIGN, "instant_form"]);
  });
  it("normalises the phone with normalisePhone and the email to lower case", () => {
    expect([p.phone_e164, p.email_lower, p.full_name]).toEqual(["+17082365732", "ray@example.com", "Ray Driver"]);
  });
  it("the phone is exactly what normalisePhone says, the one normalisation 0554 is held to", () => {
    expect(p.phone_e164).toBe(normalisePhone("(708) 236-5732"));
  });
  it("finds its opening from a recruiting brief", () => expect(p.opening_id).toBe(OPENING));
  it("names no opening when the brief came from another source", () => {
    expect(leadFromPlatform(lead({}, { brief_source: "fuel_card_offer" })).opening_id).toBeNull();
  });
  it("names no opening when the ref is not an id", () => {
    expect(leadFromPlatform(lead({}, { brief_ref: "not-a-uuid" })).opening_id).toBeNull();
  });
  it("keeps the raw payload and every answer whole", () => {
    expect([p.raw, p.answers.email]).toEqual([{ id: "123456789" }, " Ray@Example.COM "]);
  });
  it("passes its own schema", () => expect(leadProjectionSchema.safeParse(p).success).toBe(true));
});

describe("leadFromPlatform — what arrives broken", () => {
  it("a malformed phone is stored as null, never guessed (the raw keeps what was typed)", () => {
    const p = leadFromPlatform(lead({ phone_number: "555-01" }));
    expect([p.phone_e164, p.answers.phone_number]).toEqual([null, "555-01"]);
  });
  it("our form's own `phone` key is read as well as Meta's `phone_number`", () => {
    expect(leadFromPlatform(lead({ phone: "7082365732" })).phone_e164).toBe("+17082365732");
  });
  it("a split first and last name is joined", () => {
    expect(leadFromPlatform(lead({ first_name: "Ray", last_name: "Driver" })).full_name).toBe("Ray Driver");
  });
  it("an email with no @ is null", () => expect(normaliseEmail("ray.example.com")).toBeNull());
  it("an empty lead still projects, with nothing invented", () => {
    const p = leadFromPlatform(lead({}));
    expect([p.full_name, p.phone_e164, p.email_lower]).toEqual([null, null, null]);
  });
});

describe("opening — the one thing an ad may advertise", () => {
  const save = {
    opening_id: null, profile_version_id: OPENING, title: "Class A regional", headcount: 3,
    facts: { pay: { per: "mile", min_cents: 62, max_cents: 70 }, home_time: "Home weekly", equipment: ["dry_van", "reefer"], lanes: null, start_date: null },
    area: { label: "Joliet yard", latitude: 41.52, longitude: -88.08, radius_miles: 50, reason: "Home weekly from the yard" },
  };
  it("a full opening parses", () => expect(openingSaveSchema.safeParse(save).success).toBe(true));
  it("an area under 15 miles is refused — the ads area schema is the one rule", () => {
    expect(openingSaveSchema.safeParse({ ...save, area: { ...save.area, radius_miles: 10 } }).success).toBe(false);
  });
  it("a pay range upside down is refused", () => {
    expect(openingSaveSchema.safeParse({ ...save, facts: { ...save.facts, pay: { per: "mile", min_cents: 70, max_cents: 62 } } }).success).toBe(false);
  });
  it("a fact outside the shape (a ZIP) is refused", () => {
    expect(openingSaveSchema.safeParse({ ...save, facts: { ...save.facts, zip: "60431" } }).success).toBe(false);
  });
  it("the row for save_opening_version flattens the area into its columns", () => {
    const row = openingVersionRow(openingSaveSchema.parse(save));
    expect([row.area_radius_miles, row.area_reason, "area" in row]).toEqual([50, "Home weekly from the yard", false]);
  });
});
