import { describe, expect, it } from "vitest";
import { META_FORM_CATALOGUE } from "../../ads/metaLeadForm.js";
import { composeSmsConsent, isDraftSmsConsent } from "../../smsConsentContract.js";
import {
  APPLY_FLAG_TEXT,
  APPLY_HONEYPOT_FIELD,
  SMS_APPLY_PAGE_CONSENT,
  applyAnswersProblem,
  applyFlags,
  applyQuestions,
  applySubmitSchema,
  type ApplyChecks,
} from "./applyPageContract.js";
import { factsFor } from "./facts/index.js";
import { metaFacts } from "./facts/meta.js";
import { HIRING_PROFILE_V1 } from "./hiringProfile.js";
import { leadChannelLabel, leadAnswerRows } from "./leadDisplay.js";
import { openingFormQuestions } from "./openingBrief.js";

/**
 * APPLY-PAGE-PLAN D-AP3/D-AP4/D-AP5: the careers page's contract — the questions are the Instant Form's own, read the
 * same way; the texting box's words are the ruled draft and never draft; the submission takes nothing the contract does
 * not name; and the flags are exactly the failed checks.
 */

const BODY = {
  formToken: "t", fullName: "Ray Driver", phone: "708 236 5732", email: null, answers: { class_a_held: "yes" },
  smsOptIn: false, turnstileToken: null, [APPLY_HONEYPOT_FIELD]: "",
};

describe("the questions are the Instant Form's (D-AP3)", () => {
  it("the same keys the ad's form asks, for the same profile, in the catalogue's own English words", () => {
    const req = { ...HIRING_PROFILE_V1, hazmat: { mode: "required" as const, reason: "Hazmat lanes are most of this work." } };
    const keys = openingFormQuestions(req);
    expect(keys).toEqual(["class_a_held", "class_a_years", "hazmat_endorsement"]);
    const qs = applyQuestions(keys);
    expect(qs.map((q) => q.label)).toEqual(keys.map((k) => META_FORM_CATALOGUE[k]!.label.en));
    expect(qs[1]!.options.map((o) => o.key)).toEqual(["lt1", "1to2", "2to5", "5plus"]);
  });

  it("a key the catalogue does not hold is a programming error, not a question", () => {
    expect(() => applyQuestions(["criminal_history"])).toThrow(/not a catalogue question/);
  });

  it("an apply-page lead is read by Meta's reader and judged the same; its answers display like an ad lead's", () => {
    const answers = { class_a_held: "yes", class_a_years: "2to5", hazmat_endorsement: "no" };
    expect(factsFor("apply_page", answers, "2026-11-20")).toEqual(metaFacts(answers));
    expect(factsFor("apply_page", answers, "2026-11-20").class_a_held).toEqual({ value: true, evidence: "self_reported" });
    expect(leadChannelLabel("apply_page")).toBe("Careers page");
    expect(leadAnswerRows(answers, "apply_page").map((r) => r.answer)).toEqual(["Yes", "2 to 5 years", "No"]);
  });

  it("the answers must be exactly the opening's questions, each with one of its options", () => {
    const qs = applyQuestions(["class_a_held", "class_a_years"]);
    expect(applyAnswersProblem(qs, { class_a_held: "yes", class_a_years: "5plus" })).toBeNull();
    expect(applyAnswersProblem(qs, { class_a_held: "yes" })).toBe("Answer: How many years of Class A driving experience do you have?");
    expect(applyAnswersProblem(qs, { class_a_held: "yes", class_a_years: "10" })).toContain("10 is not an answer to");
    expect(applyAnswersProblem(qs, { class_a_held: "yes", class_a_years: "5plus", hazmat_endorsement: "yes" })).toBe("hazmat_endorsement is not a question on this form.");
  });
});

describe("the texting box's words (D-AP4)", () => {
  it("are the ruled draft, published (never draft), carrier named on composing, and hold every disclosure the draft has", () => {
    expect(isDraftSmsConsent(SMS_APPLY_PAGE_CONSENT)).toBe(false);
    const c = composeSmsConsent(SMS_APPLY_PAGE_CONSENT, "Silvicom Inc");
    expect(c.body).not.toContain("{{carrier}}");
    for (const phrase of [
      "I agree to receive text messages from Silvicom Inc at the mobile number above about my job application",
      "application links, interview and orientation scheduling, and hiring updates",
      "Consent is not a condition of applying or of employment.",
      "Message frequency varies.", "Msg & data rates may apply.", "Reply STOP to opt out, HELP for help.",
      "We will not share your mobile number or opt-in with third parties for marketing.",
    ]) expect(c.body).toContain(phrase);
    expect(c.title).toBe("Text me about my application (optional).");
    // The links sit beside the words on the page; a URL in stored evidence is a promise about a page that changes.
    expect(c.body).not.toMatch(/https?:|\/sms-terms|\/privacy/);
  });
});

describe("what a submission may carry", () => {
  it("a clean body parses", () => {
    expect(applySubmitSchema.safeParse(BODY).success).toBe(true);
  });

  it("takes no field it does not name: no SSN, date of birth, licence number, criminal or EEO answer can arrive", () => {
    for (const extra of ["ssn", "date_of_birth", "licence_number", "criminal_history", "race", "gender", "veteran"]) {
      expect(applySubmitSchema.safeParse({ ...BODY, [extra]: "000-12-3456" }).success, extra).toBe(false);
    }
  });

  it("needs a way to reach the person, a number that can be dialled, an email that reads as one, and a number for a ticked box", () => {
    const issue = (over: Record<string, unknown>) => {
      const r = applySubmitSchema.safeParse({ ...BODY, ...over });
      return r.success ? null : { path: r.error.issues[0]!.path[0], message: r.error.issues[0]!.message };
    };
    expect(issue({ phone: null, email: null })).toEqual({ path: "phone", message: "Enter a mobile number or an email so we can reach you." });
    expect(issue({ phone: "12345" })?.path).toBe("phone");
    expect(issue({ phone: null, email: "ray@" })?.path).toBe("email");
    expect(issue({ phone: null, email: "ray@example.com", smsOptIn: true })).toEqual({ path: "phone", message: "Enter the mobile number to text, or untick the box." });
    expect(issue({ phone: null, email: "ray@example.com" })).toBeNull();
    expect(issue({ fullName: " R " })?.path).toBe("fullName");
    expect(issue({ turnstileToken: "x".repeat(2049) })?.path).toBe("turnstileToken");
  });
});

describe("the flags are exactly the failed checks (D-AP5)", () => {
  const clean: Omit<ApplyChecks, "flags"> = {
    turnstile: "passed", turnstile_errors: [], honeypot: "empty", fill: "ok", fill_ms: 30_000, address_last_hour: 0, number_last_day: 0,
  };
  it("a clean submission raises none; a check that could not run raises none", () => {
    expect(applyFlags(clean)).toEqual([]);
    expect(applyFlags({ ...clean, turnstile: "not_configured", fill: "not_measured", fill_ms: null })).toEqual([]);
    expect(applyFlags({ ...clean, turnstile: "unavailable" })).toEqual([]);
  });

  it("each failure raises its own flag, at the limits exactly", () => {
    expect(applyFlags({ ...clean, turnstile: "failed" })).toEqual(["robot_check_failed"]);
    expect(applyFlags({ ...clean, turnstile: "missing" })).toEqual(["robot_check_missing"]);
    expect(applyFlags({ ...clean, honeypot: "filled" })).toEqual(["honeypot_filled"]);
    expect(applyFlags({ ...clean, fill: "too_fast" })).toEqual(["too_fast"]);
    expect(applyFlags({ ...clean, fill: "token_invalid" })).toEqual(["form_token_invalid"]);
    expect(applyFlags({ ...clean, address_last_hour: 4, number_last_day: 2 })).toEqual([]);
    expect(applyFlags({ ...clean, address_last_hour: 5 })).toEqual(["address_busy"]);
    expect(applyFlags({ ...clean, number_last_day: 3 })).toEqual(["number_busy"]);
  });

  it("every flag has the office's sentence", () => {
    const all = applyFlags({ ...clean, turnstile: "failed", honeypot: "filled", fill: "too_fast", address_last_hour: 9, number_last_day: 9 });
    for (const f of all) expect(APPLY_FLAG_TEXT[f].length).toBeGreaterThan(10);
  });
});
