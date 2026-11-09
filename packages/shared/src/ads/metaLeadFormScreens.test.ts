import { describe, expect, it } from "vitest";
import type { AdClaim } from "./contracts.js";
import {
  introLines, META_FORM_WORDS, META_INTRO_BULLET_MAX, META_INTRO_TITLE_MAX, META_THANK_YOU_TITLE_MAX, metaFormScreens,
} from "./metaLeadFormScreens.js";

const AGE: AdClaim = { kind: "quantity", value: 23, unit: "age" };
const YEARS: AdClaim = { kind: "quantity", value: 2, unit: "year" };
const PAY: AdClaim = { kind: "money", cents: 62, per: "mile" };
const FULL = { form_questions: ["class_a_held", "class_a_years", "hazmat_endorsement"], claims: [PAY, AGE, YEARS] };

describe("metaFormScreens (LQ1, Q-AD47 (a): higher intent and SMS verification on every form)", () => {
  it("every form is higher intent and SMS-verified, in both languages", () => {
    for (const l of ["en", "es"] as const) {
      const r = metaFormScreens(FULL, l);
      if (!r.ok) throw new Error(r.refused.join());
      expect([r.screens.is_optimized_for_quality, r.screens.is_phone_sms_verify_enabled]).toEqual([true, true]);
    }
  });

  it("the intro lists what the job needs, from the brief only, in the questions' order then age", () => {
    expect(introLines(FULL, "en")).toEqual(["A valid Class A CDL", "At least 2 years of Class A driving", "Hazmat (H) endorsement", "23 or older"]);
    expect(introLines(FULL, "es")).toEqual(["Licencia CDL Clase A vigente", "2 años o más manejando con Clase A", "Endoso de materiales peligrosos (H)", "23 años o más"]);
  });

  it("a years question without a years claim gets no years line — never a number the brief does not hold", () => {
    expect(introLines({ form_questions: ["class_a_held", "class_a_years"], claims: [AGE] }, "en")).toEqual(["A valid Class A CDL", "23 or older"]);
  });

  it("no hazmat line unless the form asks the hazmat question", () => {
    expect(introLines({ form_questions: ["class_a_held"], claims: [AGE] }, "en")).toEqual(["A valid Class A CDL", "23 or older"]);
  });

  it("no requirement at all means no intro card, and the thank-you page is still sent", () => {
    const r = metaFormScreens({ form_questions: [], claims: [PAY] }, "en");
    if (!r.ok) throw new Error(r.refused.join());
    expect(r.screens.context_card).toBeUndefined();
    expect(r.screens.thank_you_page.title).toBe(META_FORM_WORDS.thank_you_title.en);
  });

  it("the thank-you page promises a call but no time, and offers no button (Q-AD53)", () => {
    const r = metaFormScreens(FULL, "en");
    if (!r.ok) throw new Error(r.refused.join());
    expect(r.screens.thank_you_page).toEqual({ title: "Thanks — a recruiter will call you", body: "Please keep your phone nearby.", button_type: "NONE" });
  });

  it("the intro card is a list under the fixed title", () => {
    const r = metaFormScreens(FULL, "es");
    if (!r.ok) throw new Error(r.refused.join());
    expect(r.screens.context_card).toMatchObject({ title: "Lo que pide este trabajo", style: "LIST_STYLE" });
  });

  it("every fixed sentence fits Meta's limits in both languages", () => {
    for (const l of ["en", "es"] as const) {
      expect(META_FORM_WORDS.intro_title[l].length).toBeLessThanOrEqual(META_INTRO_TITLE_MAX);
      expect(META_FORM_WORDS.thank_you_title[l].length).toBeLessThanOrEqual(META_THANK_YOU_TITLE_MAX);
      for (const line of introLines({ ...FULL, claims: [PAY, { ...AGE, value: 99 }, { ...YEARS, value: 99 }] }, l)) expect(line.length).toBeLessThanOrEqual(META_INTRO_BULLET_MAX);
    }
  });

  it("a figure the claim checker cannot place refuses the form rather than showing it", () => {
    // An age of 1000 is a claim the brief holds, but the checker does not read "1000 or older" as an age.
    const r = metaFormScreens({ form_questions: [], claims: [{ ...AGE, value: 1000 }] }, "en");
    expect(r).toEqual({ ok: false, refused: ["intro_claim_not_in_brief"] });
  });
});
