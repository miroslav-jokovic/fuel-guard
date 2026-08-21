import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import ApplyPage from "@/pages/ApplyPage.vue";

/**
 * The applicant's page (H5b). Three things are pinned, and all three are about what a person with no
 * account sees.
 *
 * The disclosures are READ-ONLY while the wording is draft (Q-H3) — shown, so nobody is asked weeks
 * later to sign four documents they have never seen, and unsignable, because FCRA §604(b)(2) makes
 * each one its own document and a checkbox on this page would be the arrangement the regulation
 * forbids.
 *
 * A dead link says one thing. And nothing on the page requires a session.
 */

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", fetchMock);
vi.mock("vue-router", () => ({ useRoute: () => ({ params: { token: "t".repeat(43) } }) }));

const RELEASES = [
  {
    purpose: "fcra_disclosure", version: "v0-draft", title: "Disclosure regarding background reports",
    citation: "FCRA §604(b)(2)", body: "We may obtain consumer reports about you.",
    intent: "I authorize the preparation of consumer reports about me.", draft: true,
  },
  {
    purpose: "psp", version: "v0-draft", title: "PSP disclosure and authorization",
    citation: "49 CFR §391.23", body: "We may obtain your FMCSA crash and inspection history.",
    intent: "I authorize the carrier to obtain my PSP record.", draft: true,
  },
];

/**
 * A draft complete enough to walk the wizard with. Every screen validates against the server's own
 * schema, so a test that clicks Next five times is also a test that the sections' field sets are
 * right — a field on the wrong screen strands the driver on a step they cannot pass.
 */
const COMPLETE_DRAFT = {
  first_name: "Susan", middle_name: "", last_name: "Godfrey", date_of_birth: "1980-04-01",
  email: "s@example.test", phone: "555-0111",
  addresses: [{ line1: "1 Road", line2: "", city: "Joliet", state: "IL", postal_code: "60432", from: "2020-01", to: "" }],
  cdl_number: "PA334554", cdl_state: "PA", cdl_class: "", cdl_expires_at: "2029-01-01",
  additional_licences: [],
  experience: "", accidents: [], declares_no_accidents: true,
  violations: [], declares_no_violations: true,
  licence_ever_denied: false, licence_denial_detail: "",
  employers: [{
    employer_name: "Old Carrier", usdot_number: "123456", address_line1: "12 Depot Rd", city: "Joliet",
    state: "IL", phone: "555-0100", email: "", position_held: "Driver",
    started_on: "2023-01-01", ended_on: "2025-06-30",
    operated_cmv: true, dot_regulated: true, reason_for_leaving: "Better route",
    subject_to_fmcsr: true, safety_sensitive: true,
  }],
  declares_no_employment: false,
};

const ok = (body: unknown) => ({ ok: true, json: async () => body });
const dead = () => ({ ok: false, json: async () => ({ error: { code: "invalid_link", message: "This application link is not valid. Ask for a new one." } }) });

const mountPage = () =>
  mount(ApplyPage, { global: { plugins: [VueQueryPlugin] } });

/** The primary control at the bottom of a step — Next, then Check my answers, then Send. */
const advance = async (w: ReturnType<typeof mountPage>) => {
  const buttons = w.findAll("button");
  await buttons[buttons.length - 1]!.trigger("click");
  await settle(w);
};

const settle = async (w: ReturnType<typeof mountPage>) => {
  for (let i = 0; i < 12; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};

describe("the applicant's page", () => {
  beforeEach(() => fetchMock.mockReset());

  it("asks the public endpoint with no Authorization header", async () => {
    fetchMock.mockResolvedValue(ok({ carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES }));
    const w = mountPage();
    await settle(w);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/api/public/application/");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    // An applicant has no session, and a recruiter signed in on the same browser must not have their
    // identity ride along.
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain("authorization");
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain("x-step-up-token");
  });

  it("shows the carrier's name on the first screen", async () => {
    fetchMock.mockResolvedValue(ok({ carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES }));
    const w = mountPage();
    await settle(w);

    expect(w.text()).toContain("Silvicom Inc");
  });

  /**
   * Read-only: marked as not final, and with nothing on the page that could record a signature.
   *
   * They live on the last screen since A3 — the driver sees them beside the certification rather
   * than half-way down a form, and still sees them, so nobody is asked weeks later to sign four
   * documents they have never read.
   */
  it("presents draft disclosures as unsignable, on the screen where they sign", async () => {
    fetchMock.mockResolvedValue(ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES,
      phases: { consentedAt: null, releasesCompletedAt: null, submittedAt: null },
      draft: { locked: false, payload: COMPLETE_DRAFT, furthestSection: null, updatedAt: null },
    }));
    const w = mountPage();
    await settle(w);

    // identity → addresses → licence → employment → safety → review → certify
    for (let i = 0; i < 6; i++) await advance(w);

    expect(w.text()).toContain("Sign and send");
    // The wording is SERVED, so what somebody signed is a fact the server can prove — never shipped
    // in the client bundle where a build could change it.
    expect(w.text()).toContain("We may obtain your FMCSA crash and inspection history.");
    expect(w.text()).toContain("Not final");
    expect(w.text()).toContain("nothing here is being signed today");
    // The only checkbox on the screen is the §391.21(b)(12) certification of the application itself.
    const checkboxLabels = w.findAll("label").map((l) => l.text()).join(" ");
    expect(checkboxLabels).not.toContain("I authorize");
  });

  /** The wizard, end to end — and a working proof that every screen's field set validates. */
  it("walks one screen at a time and ends on the certification", async () => {
    fetchMock.mockResolvedValue(ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES,
      phases: { consentedAt: null, releasesCompletedAt: null, submittedAt: null },
      draft: { locked: false, payload: COMPLETE_DRAFT, furthestSection: null, updatedAt: null },
    }));
    const w = mountPage();
    await settle(w);

    expect(w.text()).toContain("Step 1 of 7");
    expect(w.text()).toContain("About you");
    // §391.21(b)(2) — the paragraph is named on the screen that discharges it.
    expect(w.text()).toContain("§391.21(b)(2)");

    await advance(w);
    expect(w.text()).toContain("Where you have lived");
    await advance(w);
    expect(w.text()).toContain("Your licence");
    // §391.21(b)(5)'s "each": the list the schema carried no field for until A3.
    expect(w.text()).toContain("Any other licences or permits");
    await advance(w);
    expect(w.text()).toContain("Where you have worked");
    await advance(w);
    expect(w.text()).toContain("Your driving record");
    await advance(w);
    // Nobody certifies what they cannot see (§391.21(b)(12)).
    expect(w.text()).toContain("Check your answers");
    expect(w.text()).toContain("Susan Godfrey");
    await advance(w);
    expect(w.text()).toContain("Send my application");
  });

  /** Forward is gated on the screen being complete; the driver is told what is missing. */
  it("refuses to advance past an incomplete screen and names the field", async () => {
    fetchMock.mockResolvedValue(ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES,
      phases: { consentedAt: null, releasesCompletedAt: null, submittedAt: null },
      draft: { locked: false, payload: null, furthestSection: null, updatedAt: null },
    }));
    const w = mountPage();
    await settle(w);

    await advance(w);
    expect(w.text()).toContain("Before you can go on");
    expect(w.text()).toContain("first_name");
    // And it did not move on.
    expect(w.text()).toContain("Step 1 of 7");
  });

  /** The saved section is where a resumed session opens. */
  it("resumes on the screen the driver had reached", async () => {
    fetchMock.mockResolvedValue(ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES,
      phases: { consentedAt: null, releasesCompletedAt: null, submittedAt: null },
      draft: { locked: false, payload: COMPLETE_DRAFT, furthestSection: "employment", updatedAt: null },
    }));
    const w = mountPage();
    await settle(w);

    expect(w.text()).toContain("Where you have worked");
    expect(w.text()).toContain("Step 4 of 7");
  });

  /**
   * A1. The link is a session now (D-APP1): submitting spends one phase, not the token, so a driver
   * who closes the tab and clicks the same email again is shown what happened instead of being told
   * their own application link is broken.
   */
  it("shows what was sent when the link is reopened after submission", async () => {
    fetchMock.mockResolvedValue(ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES,
      phases: { consentedAt: null, releasesCompletedAt: null, submittedAt: "2026-08-21T10:00:00Z" },
    }));
    const w = mountPage();
    await settle(w);

    expect(w.text()).toContain("Your application is in");
    // And the form is gone — there is nothing here to fill in or send a second time.
    expect(w.text()).not.toContain("Send my application");
    // The old copy promised a later signing step through a link this page had just closed.
    expect(w.text()).not.toContain("you will be asked to sign");
  });

  /**
   * A4/D-APP5. §390.32(d) makes an electronic §391.21 application conditional on including proof of
   * 15 U.S.C. 7001(c) consent, so it is the first thing on the link — and asked for only when the
   * server says it can be recorded, which is not until counsel's wording is published (A0).
   */
  it("asks for the electronic-records consent before anything else, once it can be recorded", async () => {
    fetchMock.mockResolvedValue(ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES,
      phases: { consentedAt: null, releasesCompletedAt: null, submittedAt: null },
      draft: { locked: false, payload: COMPLETE_DRAFT, furthestSection: null, updatedAt: null },
      esignConsent: {
        version: "v1", title: "Agreeing to sign electronically", citation: "15 U.S.C. 7001(c)",
        body: "You can have these on paper instead\nYou do not have to do any of this electronically.",
        intent: "I agree to sign this application electronically.", draft: false, required: true,
      },
    }));
    const w = mountPage();
    await settle(w);

    expect(w.text()).toContain("Before you start");
    // The whole served text, not a summary — 7001(c) enumerates what the driver must be told.
    expect(w.text()).toContain("You do not have to do any of this electronically.");
    // And the form is not reachable behind it.
    expect(w.text()).not.toContain("Step 1 of 7");
  });

  it("does not ask while the wording is still draft, because nothing could record it", async () => {
    fetchMock.mockResolvedValue(ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES,
      phases: { consentedAt: null, releasesCompletedAt: null, submittedAt: null },
      draft: { locked: false, payload: COMPLETE_DRAFT, furthestSection: null, updatedAt: null },
      esignConsent: {
        version: "v0-draft", title: "Agreeing to sign electronically", citation: "15 U.S.C. 7001(c)",
        body: "Placeholder.", intent: "I agree.", draft: true, required: false,
      },
    }));
    const w = mountPage();
    await settle(w);

    expect(w.text()).not.toContain("Before you start");
    expect(w.text()).toContain("Step 1 of 7");
  });

  it("goes straight to the form for a driver who already consented", async () => {
    fetchMock.mockResolvedValue(ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES,
      phases: { consentedAt: "2026-08-21T09:00:00Z", releasesCompletedAt: null, submittedAt: null },
      draft: { locked: false, payload: COMPLETE_DRAFT, furthestSection: null, updatedAt: null },
      esignConsent: {
        version: "v1", title: "Agreeing to sign electronically", citation: "15 U.S.C. 7001(c)",
        body: "Text.", intent: "I agree.", draft: false, required: true,
      },
    }));
    const w = mountPage();
    await settle(w);

    expect(w.text()).not.toContain("Before you start");
    expect(w.text()).toContain("Step 1 of 7");
  });

  /**
   * A2/D-APP16. The link is a session and A10 re-sends it by email; an email is forwarded and a
   * phone is shared, so a draft holding a date of birth is not something the bare link reads back.
   */
  it("asks for the date of birth before showing a draft that contains one", async () => {
    fetchMock.mockResolvedValue(ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES,
      phases: { consentedAt: null, releasesCompletedAt: null, submittedAt: null },
      draft: { locked: true, payload: null, furthestSection: "identity", updatedAt: "2026-08-21T09:00:00Z" },
    }));
    const w = mountPage();
    await settle(w);

    expect(w.text()).toContain("Pick up where you left off");
    // The form is not on screen, so nothing can be typed into — or saved over — a draft the holder
    // of this link has not proved they may read.
    expect(w.text()).not.toContain("Send my application");
  });

  it("shows the form straight away when the draft has nothing sensitive in it yet", async () => {
    fetchMock.mockResolvedValue(ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES,
      phases: { consentedAt: null, releasesCompletedAt: null, submittedAt: null },
      draft: { locked: false, payload: { first_name: "Susan" }, furthestSection: "identity", updatedAt: null },
    }));
    const w = mountPage();
    await settle(w);

    // Before a date of birth is typed there is nothing to protect, so no question is asked.
    expect(w.text()).not.toContain("Pick up where you left off");
    expect(w.text()).toContain("Step 1 of 7");
    expect((w.find("input[autocomplete=\"given-name\"]").element as HTMLInputElement).value).toBe("Susan");
  });

  it("says one thing about a dead link, whatever killed it", async () => {
    fetchMock.mockResolvedValue(dead());
    const w = mountPage();
    await settle(w);
    expect(w.text()).toContain("This link is not valid");
    expect(w.text()).toContain("Ask the carrier who invited you for a new one");
  });
});
