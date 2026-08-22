import { describe, it, expect } from "vitest";
import {
  SMS_CONSENT,
  composeSmsConsent,
  isDraftSmsConsent,
  isHelpMessage,
  isStopMessage,
  normalisePhone,
  smsConsentGrantSchema,
} from "./smsConsentContract.js";

/**
 * Consent to be texted (A11b, D-APP13).
 *
 * Everything here is one-sided in the same direction, because the penalty is: honouring an opt-out
 * that was not quite a keyword costs one message nobody wanted to send; missing a real one costs $500
 * to $1,500 and a complaint to a carrier that can switch the number off.
 */

describe("the opt-out", () => {
  it("honours the keywords every US carrier requires", () => {
    for (const word of ["STOP", "stop", "  Stop  ", "STOPALL", "unsubscribe", "CANCEL", "end", "quit"]) {
      expect(isStopMessage(word), word).toBe(true);
    }
  });

  /** ⚠ The asymmetry, made explicit: a sentence containing a keyword is an opt-out. */
  it("honours a sentence that plainly means stop, not just the bare keyword", () => {
    expect(isStopMessage("please stop")).toBe(true);
    expect(isStopMessage("STOP texting me")).toBe(true);
    expect(isStopMessage("can you cancel these")).toBe(true);
  });

  /** And does not fire on a word that merely contains one — `stopped` is not `stop`. */
  it("does not opt somebody out of a message that was not about opting out", () => {
    expect(isStopMessage("I stopped by the yard yesterday")).toBe(false);
    expect(isStopMessage("yes I am still interested")).toBe(false);
    expect(isStopMessage("")).toBe(false);
    expect(isStopMessage(null)).toBe(false);
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
});

describe("the instrument", () => {
  /** Placeholder wording, exactly like `DISCLOSURES` — and the gate is the version string (A0/Q-H3). */
  it("is draft, so nothing can be recorded against it yet", () => {
    expect(isDraftSmsConsent()).toBe(true);
    expect(SMS_CONSENT.version).toBe("v0-draft");
  });

  /** §64.1200(f)(9)'s clause that a consent form most often gets wrong. */
  it("says agreeing is not a condition of being considered", () => {
    expect(SMS_CONSENT.body).toContain("NOT required to agree");
  });

  it("tells the reader how to stop, in the consent itself", () => {
    expect(SMS_CONSENT.body).toContain("STOP");
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
