import { describe, it, expect } from "vitest";
import { effectScope, ref } from "vue";
import { APPLICATION_SECTION_ORDER, driverApplicationSchema } from "@fuelguard/shared";
import { emptyDraft, type ApplicationDraft } from "./draft";
import { issuesFromParse, useApplicationWizard, validateSection } from "./useApplicationWizard";
import { toApplication } from "./draft";

/**
 * Per-screen validation (A3).
 *
 * The property worth pinning is not "it rejects bad input" — the contract does that. It is that a
 * screen is judged by the SERVER'S schema, restricted to its own fields: a screen that borrowed a
 * rule from the next one would trap the driver, and a screen that dropped one would let them reach
 * the certification with a document the server then refuses.
 */

const complete = (): ApplicationDraft => ({
  ...emptyDraft(),
  first_name: "Susan", last_name: "Godfrey", date_of_birth: "1980-04-01",
  email: "s@example.test", phone: "555-0111",
  addresses: [{ line1: "1 Road", line2: "", city: "Joliet", state: "IL", postal_code: "60432", from: "2020-01", to: "" }],
  cdl_number: "PA334554", cdl_state: "PA", cdl_expires_at: "2029-01-01",
  employers: [{
    employer_name: "Old Carrier", usdot_number: "123456", address_line1: "12 Depot Rd", city: "Joliet", state: "IL",
    phone: "555-0100", email: "", position_held: "Driver", started_on: "2023-01-01", ended_on: "2025-06-30",
    operated_cmv: true, dot_regulated: true, reason_for_leaving: "Better route",
    subject_to_fmcsr: true, safety_sensitive: true,
  }],
  declares_no_accidents: true, declares_no_violations: true,
  certified: true, signed_name: "Susan Godfrey",
});

describe("one screen at a time", () => {
  it("passes every screen for a complete application", () => {
    const draft = complete();
    for (const section of APPLICATION_SECTION_ORDER) {
      expect({ section, issues: validateSection(section, draft) }).toEqual({ section, issues: [] });
    }
  });

  it("judges a screen only by its own fields", () => {
    // Nothing filled in at all. The identity screen complains about identity, and about nothing the
    // driver has not been shown yet — a form that demanded a licence number on the first screen
    // would be a form nobody finishes.
    const issues = validateSection("identity", emptyDraft());
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.map((i) => i.key)).toContain("first_name");
    expect(issues.map((i) => i.key)).not.toContain("cdl_number");
    expect(issues.map((i) => i.key)).not.toContain("employers");
  });

  /** An empty list is an ANSWER, not an omission — and only the driver can turn one into the other. */
  it("carries the cross-field rules onto the screen that owns them", () => {
    const draft = { ...complete(), accidents: [], declares_no_accidents: false };
    const safety = validateSection("safety", draft);
    expect(safety.map((i) => i.message)).toContain(
      "List every accident in the last 3 years, or confirm there were none",
    );
    // And nowhere else: the identity screen must not fail because a list further on is empty.
    expect(validateSection("identity", draft)).toEqual([]);
  });

  it("asks for the denial detail only once the driver says there was one", () => {
    expect(validateSection("safety", complete())).toEqual([]);
    const denied = { ...complete(), licence_ever_denied: true, licence_denial_detail: "" };
    expect(validateSection("safety", denied).map((i) => i.key)).toContain("licence_denial_detail");
  });

  it("has nothing to check on the review screen, which owns no fields", () => {
    expect(validateSection("review", emptyDraft())).toEqual([]);
  });

  /**
   * §391.21(b)(5): the list the schema had no field for until A3. A licence the driver adds must
   * validate on the licence screen and nowhere else.
   */
  it("validates the extra licences on the licence screen", () => {
    const draft = {
      ...complete(),
      additional_licences: [{ issuing_authority: "", number: "X1", expires_at: "2030-01-01", kind: "" }],
    };
    const issues = validateSection("licence", draft);
    expect(issues.map((i) => i.key)).toContain("additional_licences");
  });
});

describe("sending the whole document", () => {
  it("attributes each failure to the screen that can fix it", () => {
    const parsed = driverApplicationSchema.safeParse(toApplication({ ...complete(), employers: [], declares_no_employment: false }));
    expect(parsed.success).toBe(false);
    const issues = issuesFromParse(parsed.success ? [] : parsed.error.issues);
    expect(issues.some((i) => i.key === "employers" && i.section === "employment")).toBe(true);
  });

  /**
   * ⚠ The regression this file exists to prevent, found on 2026-08-21 when the nested schemas became
   * `.strict()`: the form collected each conviction's place into `location`, the contract defined
   * `state`, and zod dropped the key without a word. Strict mode turns that into a hard error, and
   * this asserts the answer now arrives.
   */
  it("carries a conviction's place, which used to fall through the gap between form and contract", () => {
    const draft = {
      ...complete(),
      declares_no_violations: false,
      violations: [{ occurred_on: "2025-02-01", offence: "Speeding", state: "IL", penalty: "$120" }],
    };
    const parsed = driverApplicationSchema.safeParse(toApplication(draft));
    expect(parsed.success).toBe(true);
    expect(parsed.success ? parsed.data.violations[0]?.state : null).toBe("IL");
  });
});

describe("moving between screens", () => {
  const wizard = (draft: ApplicationDraft, resumeAt: string | null = null) =>
    effectScope().run(() => useApplicationWizard(draft, ref(resumeAt)))!;

  it("advances only when the screen is complete", () => {
    const w = wizard(emptyDraft());
    expect(w.next()).toBe(false);
    expect(w.section.value).toBe("identity");
    expect(w.issues.value.length).toBeGreaterThan(0);

    const ok = wizard(complete());
    expect(ok.next()).toBe(true);
    expect(ok.section.value).toBe("addresses");
  });

  it("never blocks going back, whatever the screen in front says", () => {
    const w = wizard(complete());
    w.next();
    // Break the screen they are standing on, then go back anyway — a driver who needs to fix
    // something behind them must not be trapped by the field in front of them.
    w.goTo("safety");
    w.back();
    expect(w.section.value).toBe("employment");
    expect(w.issues.value).toEqual([]);
  });

  /**
   * `application_drafts.furthest_section` is named for what it stores. Stepping back to correct an
   * address is not un-reaching the screen you got to, and a driver who closed the tab after doing so
   * must not resume at the top of a form they had almost finished.
   */
  it("keeps the furthest screen reached when the driver steps back", () => {
    const w = wizard(complete());
    w.goTo("safety");
    expect(w.furthestSection.value).toBe("safety");
    w.back();
    w.back();
    expect(w.section.value).toBe("licence");
    expect(w.furthestSection.value).toBe("safety");
  });

  it("resumes where the saved draft says, and treats that as reached", () => {
    const w = wizard(complete(), "employment");
    w.resume();
    expect(w.section.value).toBe("employment");
    expect(w.furthestSection.value).toBe("employment");
  });

  /** `furthest_section` is free text in the database, so a stored value may be from another version. */
  it("ignores a saved section it does not recognise", () => {
    const w = wizard(complete(), "documents");
    w.resume();
    expect(w.section.value).toBe("identity");
  });
});
