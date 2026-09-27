import { describe, it, expect } from "vitest";
import {
  SMS_CONSENT,
  composeSmsConsent,
  isDraftSmsConsent,
  isHelpMessage,
  isStartMessage,
  isStopMessage,
  normalisePhone,
  normaliseUsPhone,
  siteHostOf,
  smsApplicationApproved,
  smsApplicationReady,
  smsDrugTestSite,
  smsApplicationReminder,
  smsApplicationPhoneLink,
  smsConsentGrantSchema,
  smsHelpReply,
  smsOptInConfirmation,
} from "./smsConsentContract.js";

/**
 * Consent to be texted (A11b, D-APP13).
 *
 * Everything here is one-sided in the same direction, because the penalty is: honouring an opt-out
 * that was not quite a keyword costs one message nobody wanted to send; missing a real one costs $500
 * to $1,500 and a complaint to a carrier that can switch the number off.
 */

describe("the opt-out", () => {
  it("honours the keywords every US carrier requires, and the two the FCC's 2024 order adds", () => {
    for (const word of ["STOP", "stop", "  Stop  ", "Stop.", "STOPALL", "unsubscribe", "CANCEL", "end", "Quit!", "revoke", "Opt-out", "opt out"]) {
      expect(isStopMessage(word), word).toBe(true);
    }
  });

  /** ⚠ The asymmetry, made explicit: a sentence containing an unambiguous keyword is an opt-out. */
  it("honours a sentence that plainly means stop, not just the bare keyword", () => {
    expect(isStopMessage("please stop")).toBe(true);
    expect(isStopMessage("STOP texting me")).toBe(true);
    expect(isStopMessage("unsubscribe me please")).toBe(true);
    expect(isStopMessage("I want to opt out")).toBe(true);
  });

  /**
   * G-2 (C2d2): "cancel", "end" and "quit" are everyday words in a reply about a job, so they count only
   * as the whole message. Each of these revoked a consent before 2026-09-26.
   */
  it("does not read cancel, end or quit inside a sentence as an opt-out", () => {
    expect(isStopMessage("I'll quit my job Friday")).toBe(false);
    expect(isStopMessage("cancel Tuesday, I can come Wednesday")).toBe(false);
    expect(isStopMessage("I can be there at the end of the week")).toBe(false);
  });

  /** And does not fire on a word that merely contains one — `stopped` is not `stop`. */
  it("does not opt somebody out of a message that was not about opting out", () => {
    expect(isStopMessage("I stopped by the yard yesterday")).toBe(false);
    expect(isStopMessage("yes I am still interested")).toBe(false);
    expect(isStopMessage("")).toBe(false);
    expect(isStopMessage(null)).toBe(false);
  });

  /** START undoes a STOP, and only as the whole message: "can I start Monday" is about the job. */
  it("recognises START and UNSTOP as the whole message only", () => {
    for (const word of ["START", "start", " Start. ", "unstop"]) expect(isStartMessage(word), word).toBe(true);
    expect(isStartMessage("can I start Monday")).toBe(false);
    expect(isStartMessage("")).toBe(false);
    expect(isStopMessage("START")).toBe(false);
  });

  it("recognises HELP, which carriers require to be answered too", () => {
    expect(isHelpMessage("HELP")).toBe(true);
    expect(isHelpMessage("info")).toBe(true);
    expect(isHelpMessage("help me finish my application")).toBe(false);
  });
});

/**
 * A stored `(708) 236-5732` that cannot be matched to an inbound `+17082365732` is a STOP that
 * silently does nothing — which is the single most expensive bug this file could contain.
 */
describe("the number", () => {
  it("normalises what a recruiter types to what a carrier sends", () => {
    for (const typed of ["7082365732", "(708) 236-5732", "708-236-5732", "1 708 236 5732", "+17082365732"]) {
      expect(normalisePhone(typed), typed).toBe("+17082365732");
    }
  });

  /** A guess here is a text to a stranger, which is the expensive kind of mistake. */
  it("refuses anything it would have to guess at", () => {
    expect(normalisePhone("12345")).toBeNull();
    expect(normalisePhone("not a number")).toBeNull();
    expect(normalisePhone(null)).toBeNull();
    expect(normalisePhone("")).toBeNull();
  });

  it("keeps an international number that already says what it is", () => {
    expect(normalisePhone("+447700900123")).toBe("+447700900123");
  });

  /**
   * G-2 (C2d2): agreeing takes a dialable US number only. Matching stays permissive (above), because an
   * inbound STOP must find its row whatever shape it arrives in.
   */
  it("accepts only a dialable US number for agreeing to texts", () => {
    for (const typed of ["7082365732", "(708) 236-5732", "+17082365732"]) {
      expect(normaliseUsPhone(typed), typed).toBe("+17082365732");
    }
    expect(normaliseUsPhone("+447700900123")).toBeNull();
    // NANP: neither an area code nor an exchange starts with 0 or 1.
    expect(normaliseUsPhone("(123) 456-7890")).toBeNull();
    expect(normaliseUsPhone("(708) 136-5732")).toBeNull();
    expect(normaliseUsPhone(null)).toBeNull();
  });
});

describe("the instrument", () => {
  /**
   * Published by the owner's ruling (D-SMS10), and the gate is still the version string: a `v0` or
   * `-draft` version refuses exactly as it did, which is what counsel's redline would ship behind if
   * it ever needed to be withdrawn.
   */
  it("is published, and a draft version would still be refused", () => {
    expect(isDraftSmsConsent()).toBe(false);
    expect(isDraftSmsConsent({ ...SMS_CONSENT, version: "v0-draft" })).toBe(true);
    expect(isDraftSmsConsent({ ...SMS_CONSENT, version: "sms-2027-01-01-draft" })).toBe(true);
  });

  /**
   * Every clause the carrier template and CTIA ask for, one assertion each — so a later edit that
   * "tidies" the paragraph cannot drop the one sentence a verification reviewer reads for.
   */
  it.each([
    ["the sender", "{{carrier}}"],
    ["what the messages are about", "about your driver application"],
    ["that they are not marketing", "not marketing"],
    ["the frequency", "Message frequency varies"],
    ["the charges", "Message and data rates may apply"],
    ["help", "Reply HELP"],
    ["how to stop", "Reply STOP"],
    ["that it is optional — §64.1200(f)(9)(i)(B)", "not a condition of applying or of being considered"],
    ["the number it attaches to", "the mobile number you entered"],
  ])("says %s", (_what, needle) => {
    expect(SMS_CONSENT.body).toContain(needle);
  });

  /** A URL inside stored evidence is a promise about a page that will change; the links sit beside it. */
  it("carries no link", () => {
    expect(SMS_CONSENT.body).not.toMatch(/https?:|\/sms-terms|\/privacy/);
  });

  /** Composed server-side: a client-authored record of what somebody agreed to is worth nothing. */
  it("fills the carrier's name into both halves", () => {
    const doc = composeSmsConsent(SMS_CONSENT, "Silvicom Inc");
    expect(doc.body).toContain("Silvicom Inc");
    expect(doc.intent).toContain("Silvicom Inc");
    expect(doc.body).not.toContain("{{carrier}}");
    expect(doc.intent).not.toContain("{{carrier}}");
  });

  it("takes the act and never the text", () => {
    expect(smsConsentGrantSchema.safeParse({ phone: "7082365732", agreed: true }).success).toBe(true);
    // An unaffirmed grant is not a grant.
    expect(smsConsentGrantSchema.safeParse({ phone: "7082365732", agreed: false }).success).toBe(false);
    // And the client cannot supply what it agreed to.
    const withText = smsConsentGrantSchema.safeParse({ phone: "7082365732", agreed: true, consent_text: "anything" });
    expect(withText.success && "consent_text" in withText.data).toBe(false);
  });
});

describe("every message the programme sends (the verification's sample set)", () => {
  const LINK = "https://360.silvicominc.com/apply/" + "b".repeat(43);
  const messages = {
    confirmation: smsOptInConfirmation("Silvicom Inc"),
    ready: smsApplicationReady("Silvicom Inc", LINK),
    reminder: smsApplicationReminder("Silvicom Inc", LINK),
    phoneLink: smsApplicationPhoneLink("Silvicom Inc", LINK),
    approved: smsApplicationApproved("Silvicom Inc"),
    help: smsHelpReply("360.silvicominc.com"),
  };

  /** Carriers reject a sample whose sender is not identifiable, or whose opt-out is not in the body. */
  it.each(Object.entries(messages))("%s names the sender first and says STOP", (_name, text) => {
    expect(text.startsWith("Silvicom")).toBe(true);
    expect(text).toContain("STOP");
    // Plain ASCII keeps every message in GSM-7 — one character outside it halves the part size.
    expect(/^[\x20-\x7E]*$/.test(text)).toBe(true);
  });

  /** The two with no link fit one part; the linked ones carry the full link, never a shortener. */
  it("keeps the unlinked messages to one part, and never shortens a link", () => {
    expect(messages.approved.length).toBeLessThanOrEqual(160);
    expect(messages.help.length).toBeLessThanOrEqual(160);
    expect(messages.ready).toContain(LINK);
    expect(messages.reminder).toContain(LINK);
    expect(messages.phoneLink).toContain(LINK);
    // It rotates nothing (§6.6.6): telling the driver an earlier link died would be false.
    expect(messages.phoneLink).not.toMatch(/earlier|replaces/);
  });

  it("points HELP at the terms page on the host it is given, whatever form the URL came in", () => {
    expect(smsHelpReply(siteHostOf("https://360.silvicominc.com/"))).toContain("360.silvicominc.com/sms-terms");
    expect(siteHostOf("http://localhost:5173")).toBe("localhost:5173");
  });
});

describe("the opt-in confirmation (D-SMS5)", () => {
  /**
   * One part, one charge — and every element CTIA's principles ask of a confirmation is present, so a
   * later edit that shortens it to fit cannot quietly drop the STOP a reviewer looks for.
   */
  it("fits one GSM-7 part and names the carrier, the rates, HELP and STOP", () => {
    const text = smsOptInConfirmation("Silvicom Inc");
    expect(text.length).toBeLessThanOrEqual(160);
    expect(/^[\x20-\x7E]*$/.test(text)).toBe(true);
    for (const needle of ["Silvicom Inc", "rates may apply", "HELP", "STOP"]) expect(text).toContain(needle);
  });
});

describe("smsDrugTestSite (D-AW6, C2d)", () => {
  const params = {
    site_name: "Concentra Joliet", site_address: "100 Main St, Joliet, IL", site_phone: "815-555-0100",
    window_start: "2026-09-28T14:00:00Z", window_end: "2026-09-28T16:30:00Z", donor_reference: "D-4471",
  };

  it("names the carrier, the site, the window on the carrier's clock, the reference and STOP, with no link", () => {
    const text = smsDrugTestSite("Silvicom Inc", params, "America/Chicago", "CDT");
    expect(text).toBe(
      "Silvicom Inc: Your drug test is at Concentra Joliet, 100 Main St, Joliet, IL, 09/28/2026 9:00 AM to 11:30 AM CDT. "
      + "Site phone 815-555-0100. Give them reference D-4471. Bring your photo ID. Reply STOP to opt out.",
    );
    expect(text).not.toMatch(/https?:\/\//);
  });

  it("leaves out what the office did not write down", () => {
    const text = smsDrugTestSite("Silvicom Inc", { ...params, site_phone: null, window_end: null, donor_reference: null }, "America/Chicago", "CDT");
    expect(text).toBe("Silvicom Inc: Your drug test is at Concentra Joliet, 100 Main St, Joliet, IL, 09/28/2026 9:00 AM CDT. Bring your photo ID. Reply STOP to opt out.");
  });
});
