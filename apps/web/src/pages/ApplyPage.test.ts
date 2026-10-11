import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { driverPlacements, APPLICATION_FILLING_SECTIONS, APPLICATION_RELEASE_ORDER, PART_ONE_SCREENS } from "@silvicom/shared";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import ApplyPage from "@/pages/ApplyPage.vue";
import { toDraftPayload, fromDraftPayload } from "@/features/apply/draft";
import { DRAFT_COPY_VERSION, readDraftCopy, writeDraftCopy } from "@/features/apply/draftLocal";
import { keepPhoto, readKeptPhoto } from "@/features/apply/capture/photoLocal";
import EmployerDrawer from "@/features/apply/EmployerDrawer.vue";
import ApplySection from "@/features/apply/ApplySection.vue";
import { APPLY_COPY } from "@/features/apply/strings";

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
/**
 * The camera, for the one test that takes a photo on Part 1's scanner screen: jsdom has no
 * `createImageBitmap` and no picker, so the provider answers with a page and never opens either.
 */
vi.mock("@/features/apply/capture/webFileProvider", () => ({
  createWebFileProvider: () => ({
    id: "t", version: "0", cancel: () => {},
    takeBytes: () => new Blob(["x"], { type: "image/webp" }),
    isSupported: async () => ({ supported: true, camera: true, docScanner: false, ocr: false }),
    scan: async () => ({
      ok: true,
      pages: [{ originalOfRecord: { uri: "blob:held", width: 1, height: 1, bytes: 1, mediaType: "image/webp" }, integrityHash: "ab".repeat(32) }],
    }),
  }),
}));

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
  // §391.21(b)(6) is mandatory content, and a draft that answers neither half of it cannot pass the
  // employment screen — which is the rule working, not the fixture being fussy.
  experience: "Eight years, dry van and reefer.", equipment_experience: [],
  accidents: [], declares_no_accidents: true,
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

/**
 * Read off the vocabulary rather than typed in, so adding a screen — A8 added `documents` — moves
 * these assertions instead of breaking six of them for a reason that is not the reason under test.
 */
/** The real inventory, so "the walk is the certification" is asserted against the shipped queue. */
const PACKET = driverPlacements(null).map((p) => ({ ...p, signedAt: null }));

const TOTAL = APPLICATION_FILLING_SECTIONS.length;
const step = (n: number): string => `Step ${n} of ${TOTAL}`;

const ok = (body: unknown) => ({ ok: true, json: async () => body });
const dead = () => ({ ok: false, json: async () => ({ error: { code: "invalid_link", message: "This application link is not valid. Ask for a new one." } }) });

const mountPage = () =>
  mount(ApplyPage, { global: { plugins: [VueQueryPlugin] } });

/**
 * ⚠ Every page is unmounted after its test (C3d1b). Before this, 43 of the 54 pages mounted here were
 * left alive, and their autosave timers — real ones, 2 and 5 seconds — kept running into the NEXT
 * test's `fetch` mock. Harmless while nothing counted saves; "sends nothing" failed under full-suite
 * load the day something did, because a stranger's save landed inside its window.
 */
enableAutoUnmount(afterEach);

/** The primary control at the bottom of a step — Next, then Check my answers, then Send. */
const advance = async (w: ReturnType<typeof mountPage>) => {
  const buttons = w.findAll("button");
  await buttons[buttons.length - 1]!.trigger("click");
  await settle(w);
};

/**
 * Get past the expectations screen (B7), which is what an untouched link now opens on.
 *
 * ⚠ It asserts the button is there rather than clicking it if it happens to be. A helper that
 * shrugged would let a fixture drift into "started" — a payload, a consent, a signed permission —
 * and the test would still pass while quietly no longer covering the screen it was written for.
 */
const start = async (w: ReturnType<typeof mountPage>) => {
  const button = w.findAll("button").find((b) => b.text() === APPLY_COPY.expectations.start);
  expect(button, "the expectations screen is not on this untouched link").toBeTruthy();
  await button!.trigger("click");
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

    // identity → addresses → licence → employment → safety → questions → documents → review
    for (let i = 0; i < TOTAL - 1; i++) await advance(w);

    // ⚠ "Check your answers" is the last screen of the FIRST visit since F4. The certification is not
    // on it: the office reads the application before anybody signs it, so a signature taken here
    // would be a signature on a document that may still change.
    expect(w.text()).toContain("Check your answers");
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
  it("walks one screen at a time and ends by handing it to the carrier", async () => {
    // ⚠ PUBLISHED wording, since 2026-08-23: with draft instruments the last screen offers "Not
    // ready to send yet" instead, which is the next test. This one is about the nine screens.
    fetchMock.mockResolvedValue(ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z",
      releases: RELEASES.map((r) => ({ ...r, version: "v1", draft: false })),
      phases: { consentedAt: "2026-08-21T09:00:00Z", releasesCompletedAt: "2026-08-21T09:10:00Z", submittedAt: null },
      draft: { locked: false, payload: COMPLETE_DRAFT, furthestSection: null, updatedAt: null },
      esignConsent: {
        version: "v1", title: "t", citation: "c", body: "b", intent: "i", draft: false, required: true,
      },
    }));
    const w = mountPage();
    await settle(w);

    expect(w.text()).toContain(step(1));
    expect(w.text()).toContain("About you");
    // D-AX7: the carrier's own page-1 questions are asked on the first screen, where its paper asks
    // them. "What job are you applying for?" was the sixth of nine steps until 2026-09-11.
    expect(w.text()).toContain("Position you are applying for");
    expect(w.text()).toContain("How did you hear about this company?");
    // ⚠ This used to assert the screen NAMED its paragraph — "§391.21(b)(2)" rendered under the
    // heading. Inverted 2026-08-22 on the owner's judgement that citations are "useless and
    // confusing for a regular user": the driver gets the words, the auditor gets the PDF. The
    // assertion is kept rather than deleted because it is now the pin in the other direction.
    expect(w.text()).not.toMatch(/§|\bCFR\b/);

    await advance(w);
    expect(w.text()).toContain("Where you have lived");
    await advance(w);
    expect(w.text()).toContain("Your licence");
    // §391.21(b)(5)'s "each": the list the schema carried no field for until A3.
    expect(w.text()).toContain("Other licences and permits, now or in the last 3 years");
    // Q-AF4: §391.23(a)(1) wants every state that licensed them in 3 years, so a licence given up on
    // moving is asked for by name — the case the old "you hold" wording could never collect.
    expect(w.text()).toContain("even if you gave it up");
    await advance(w);
    expect(w.text()).toContain("Where you have worked");
    // D-AX7's one departure from the paper: asked above the employer list rather than on page 1,
    // because a driver cannot picture who is being asked about until they have named them.
    expect(w.text()).toContain("May we contact your previous employers?");
    await advance(w);
    expect(w.text()).toContain("Your driving record");
    await advance(w);
    // A9: the carrier's own questions — and the screen says they are the carrier's, because unlike
    // every other screen in this wizard it discharges no CFR paragraph (D-APP12).
    expect(w.text()).toContain("The carrier's own questions");
    // What is LEFT on this screen after D-AX7 — the four the workbook puts on its page 16.
    expect(w.text()).toContain("Education and training");
    expect(w.text()).toContain("Three personal references");
    expect(w.text()).not.toContain("How did you hear about this company?");
    await advance(w);
    // A8: the photographs are taken while the driver still has the documents in their hand.
    expect(w.text()).toContain("Your documents");
    expect(w.text()).toContain("Front of your licence");
    await advance(w);
    // Nobody sends what they cannot see, and nobody certifies it either (§391.21(b)(12)).
    expect(w.text()).toContain("Check your answers");
    expect(w.text()).toContain("Susan Godfrey");
    // ⚠ And the last control hands it over rather than certifying it (F4, D-AX11).
    expect(w.text()).toContain("Send it to Silvicom Inc");
    expect(w.text()).not.toContain("I certify that all entries");
  });

  /**
   * ⚠ The §390.32(d) window, told on screen one instead of discovered on screen nine (2026-08-23).
   *
   * `submitApplication` refuses while the wording is draft, because a certified §391.21(b)
   * application with no 7001(c) consent behind it is not the document the regulation asked for — and
   * submitting spends the link, so the defect would be permanent. This is the page's half of that:
   * say it up front, keep the form usable (H5b, and autosave was never gated), disable the Send.
   */
  it("says the application cannot be sent yet, on the first screen and again at the Send", async () => {
    fetchMock.mockResolvedValue(ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES,
      phases: { consentedAt: null, releasesCompletedAt: null, submittedAt: null },
      draft: { locked: false, payload: COMPLETE_DRAFT, furthestSection: null, updatedAt: null },
    }));
    const w = mountPage();
    await settle(w);

    // Screen one. Not a wall — the form is right there underneath it.
    expect(w.text()).toContain("cannot be sent yet");
    expect(w.text()).toContain("everything you type is saved");
    expect(w.text()).toContain(step(1));

    for (let i = 0; i < TOTAL - 1; i++) await advance(w);
    expect(w.text()).not.toContain("Send my application");
    expect(w.text()).toContain("Not ready to send yet");
    // Disabled, not hidden: the control the driver came for is where they expect it, saying why.
    const send = w.findAll("button").find((b) => b.text().includes("Not ready to send yet"));
    expect(send?.attributes("disabled")).toBeDefined();
  });

  /** Forward is gated on the screen being complete; the driver is told what is missing. */
  it("refuses to advance past an incomplete screen and names the field in words", async () => {
    fetchMock.mockResolvedValue(ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES,
      phases: { consentedAt: null, releasesCompletedAt: null, submittedAt: null },
      draft: { locked: false, payload: null, furthestSection: null, updatedAt: null },
    }));
    const w = mountPage();
    await settle(w);
    await start(w);

    await advance(w);
    expect(w.text()).toContain("Before you can go on");
    // ⚠ This asserted `first_name` until D-AX3 — the contract key, rendered to a driver as the name
    // of the box they had not filled in. The field is now named the way the label above it names it,
    // and the message is a sentence rather than "Too small: expected string to have >=1 characters".
    expect(w.text()).toContain("First name");
    expect(w.text()).toContain("This is needed.");
    expect(w.text()).not.toContain("first_name");
    expect(w.text()).not.toMatch(/Too small|expected string/);
    // And it did not move on.
    expect(w.text()).toContain(step(1));
  });

  /**
   * ── WHERE THE ERROR IS, NOT JUST WHAT IT IS (D-AX3) ─────────────────────────────────────────
   * These two need the component in the real document: `focusFirstIssue` resolves the control with
   * `getElementById`, and `document.activeElement` means nothing for a detached tree. Every other
   * test in this file mounts detached on purpose — it is faster and none of them care.
   */
  it("puts the cursor in the first box that needs an answer", async () => {
    fetchMock.mockResolvedValue(ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES,
      phases: { consentedAt: null, releasesCompletedAt: null, submittedAt: null },
      draft: { locked: false, payload: null, furthestSection: null, updatedAt: null },
    }));
    const w = mount(ApplyPage, { global: { plugins: [VueQueryPlugin] }, attachTo: document.body });
    await settle(w);
    await start(w);
    await advance(w);

    // Not "the page scrolled to the top and printed a list" — on the employment screen the field a
    // list names can be two thousand pixels below the fold.
    expect(document.activeElement?.id).toBe("apply-first_name");
    w.unmount();
  });

  it("marks the box itself, not only the summary", async () => {
    fetchMock.mockResolvedValue(ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES,
      phases: { consentedAt: null, releasesCompletedAt: null, submittedAt: null },
      draft: { locked: false, payload: null, furthestSection: null, updatedAt: null },
    }));
    const w = mount(ApplyPage, { global: { plugins: [VueQueryPlugin] }, attachTo: document.body });
    await settle(w);
    await start(w);
    await advance(w);

    const input = document.getElementById("apply-first_name");
    expect(input?.getAttribute("aria-invalid")).toBe("true");
    // The message is rendered by the element `aria-describedby` points at, so a screen reader reads
    // the same sentence the sighted driver sees rather than a different one, or none.
    const described = document.getElementById(input?.getAttribute("aria-describedby") ?? "");
    expect(described?.textContent).toBe("This is needed.");
    w.unmount();
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
    expect(w.text()).toContain(step(4));
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
    expect(w.text()).not.toContain("Send it to");
    // The old copy promised a later signing step through a link this page had just closed.
    expect(w.text()).not.toContain("you will be asked to sign");
    // No certificate in the payload, so no button that could only answer "not yet" (RT4).
    expect(w.text()).not.toContain(APPLY_COPY.done.certificate);
  });

  // RT4, §391.31(g): the link's own payload is what puts the certificate on the filed card.
  it("offers the road-test certificate on the filed card when the link has one", async () => {
    fetchMock.mockResolvedValue(ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES,
      phases: { consentedAt: null, releasesCompletedAt: null, submittedAt: "2026-08-21T10:00:00Z" },
      roadTestCertificate: { testedOn: "2026-09-25" },
    }));
    const w = mountPage();
    await settle(w);

    expect(w.text()).toContain(APPLY_COPY.done.certificate);
    expect(w.text()).toContain("09/25/2026");
  });

  /**
   * The three states the OFFICE puts the link into (F4, D-AX11/D-AX12).
   *
   * ⚠ The one that matters is the LAST of them. §391.21(b)(12) has the applicant certify that every
   * entry is true and complete, and the office can now change an entry — so the screen that asks for
   * that signature has to show what was changed, or nobody can honestly give it.
   */
  it("says the carrier has it, once it has been handed over", async () => {
    fetchMock.mockResolvedValue(ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES,
      phases: {
        consentedAt: "2026-09-09T09:00:00Z", releasesCompletedAt: "2026-09-09T09:10:00Z",
        reviewRequestedAt: "2026-09-10T09:00:00Z", approvedAt: null, submittedAt: null,
      },
      draft: { locked: false, payload: COMPLETE_DRAFT, furthestSection: null, updatedAt: null },
    }));
    const w = mountPage();
    await settle(w);

    expect(w.text()).toContain("They have your application");
    // And the form is gone: a driver who has handed it over must not be able to keep editing the
    // document somebody is reading.
    expect(w.text()).not.toContain("Step 1 of");
    expect(w.text()).not.toContain("Send it to");
  });

  it("⚠ shows what the carrier changed, above the certification, once it comes back to sign", async () => {
    fetchMock.mockResolvedValue(ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES,
      phases: {
        consentedAt: "2026-09-09T09:00:00Z", releasesCompletedAt: "2026-09-09T09:10:00Z",
        reviewRequestedAt: "2026-09-10T09:00:00Z", approvedAt: "2026-09-11T09:00:00Z", submittedAt: null,
      },
      draft: { locked: false, payload: COMPLETE_DRAFT, furthestSection: null, updatedAt: null },
      edits: [
        { path: ["employers", 0, "city"], before: "Jolliet", after: "Joliet", editedAt: "2026-09-11T08:00:00Z" },
      ],
      packet: PACKET,
    }));
    const w = mountPage();
    await settle(w);

    expect(w.text()).toContain("Ready for your signature");
    // The field in the driver's own words, not a contract path.
    expect(w.text()).toContain("Employer 1 · City");
    expect(w.text()).toContain("Jolliet");
    expect(w.text()).toContain("Joliet");
    expect(w.text()).toContain("Sign and send it");

    /**
     * ⚠ **The certification is the WALK now (D-PKT15)**, so this no longer looks for "I certify that
     * all entries" — the tick and its second name box are gone, and packet pages 11, 13 and 17 carry
     * that sentence in the carrier's own words instead.
     *
     * What the title of this test is really about survives and is asserted directly: the corrections
     * come ABOVE whatever the driver is about to affirm. D-AX12 is the reason, and it does not care
     * which of the two the affirmation is.
     */
    // ⚠ The landmark is READ from the copy, not restated. This assertion is about ORDER; a literal
    // here makes a copy edit look like a layout regression, which is what happened when the adoption
    // screen started naming the initials as well (Q-PKT8). The fixture's packet is untouched, so the
    // heading is the one that says both marks.
    const heading = APPLY_COPY.packet.adoptHeadingWithInitials;
    const text = w.text();
    expect(text).toContain(heading);
    expect(text.indexOf("Employer 1 · City")).toBeLessThan(text.indexOf(heading));
  });

  it("says plainly when the carrier changed nothing", async () => {
    // Silence would read as "we did not look". An applicant asked to re-certify is owed the answer
    // either way.
    fetchMock.mockResolvedValue(ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES,
      phases: {
        consentedAt: null, releasesCompletedAt: null,
        reviewRequestedAt: "2026-09-10T09:00:00Z", approvedAt: "2026-09-11T09:00:00Z", submittedAt: null,
      },
      draft: { locked: false, payload: COMPLETE_DRAFT, furthestSection: null, updatedAt: null },
      edits: [],
    }));
    const w = mountPage();
    await settle(w);
    expect(w.text()).toContain("They did not change any of your answers.");
  });

  /**
   * ⚠ AF5 (plan §3.1 row 9, D-AF3): approved is no longer "ready to sign". Until the office opens
   * signing at the desk the link says where signing happens and asks for nothing — not the packet,
   * not the Social Security number, not a signature `record_packet_mark` would refuse (DR036). Once
   * opened, the same link signs. ⚠ Only an explicit null holds it: an API from before AF5 sends no
   * stamp, and under that API approval DID open signing.
   */
  it("⚠ says an approved application is signed in the office, until the office opens signing", async () => {
    const approvedPage = (signingOpenedAt: string | null) => ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES,
      phases: {
        consentedAt: "2026-09-09T09:00:00Z", releasesCompletedAt: "2026-09-09T09:10:00Z",
        reviewRequestedAt: "2026-09-10T09:00:00Z", approvedAt: "2026-09-11T09:00:00Z",
        signingOpenedAt, submittedAt: null,
      },
      draft: { locked: false, payload: COMPLETE_DRAFT, furthestSection: null, updatedAt: null },
      edits: [],
      packet: PACKET,
    });

    fetchMock.mockResolvedValue(approvedPage(null));
    const waiting = mountPage();
    await settle(waiting);
    expect(waiting.text()).toContain(APPLY_COPY.signInOffice.heading);
    expect(waiting.text()).toContain("You sign it in their office");
    expect(waiting.text()).not.toContain("Ready for your signature");
    expect(waiting.text()).not.toContain("Social Security number");
    // And not "they have your application" either: that screen says the office is still reading.
    expect(waiting.text()).not.toContain(APPLY_COPY.handoff.waitingHeading);
    waiting.unmount();

    fetchMock.mockResolvedValue(approvedPage("2026-09-24T12:00:00Z"));
    const opened = mountPage();
    await settle(opened);
    expect(opened.text()).toContain("Ready for your signature");
    expect(opened.text()).not.toContain(APPLY_COPY.signInOffice.heading);
  });

  it("asks for the Social Security number on the signing screen, and nowhere else", async () => {
    // ⚠ It moved there because D-APP3 keeps it out of every saved draft: a number typed on the first
    // visit is gone by the second, and the second visit is when the file is created.
    fetchMock.mockResolvedValue(ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES,
      phases: {
        consentedAt: null, releasesCompletedAt: null,
        reviewRequestedAt: "2026-09-10T09:00:00Z", approvedAt: "2026-09-11T09:00:00Z", submittedAt: null,
      },
      draft: { locked: false, payload: COMPLETE_DRAFT, furthestSection: null, updatedAt: null },
    }));
    const w = mountPage();
    await settle(w);
    expect(w.text()).toContain("Social Security number");

    // The first screen of the first visit does not ask for it.
    fetchMock.mockResolvedValue(ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES,
      phases: { consentedAt: null, releasesCompletedAt: null, submittedAt: null },
    }));
    const first = mountPage();
    await settle(first);
    expect(first.text()).toContain("About you");
    expect(first.text()).not.toContain("Social Security number");
  });

  it("hands the application over when the last screen's button is pressed", async () => {
    fetchMock.mockResolvedValue(ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z",
      releases: RELEASES.map((r) => ({ ...r, version: "v1", draft: false })),
      phases: { consentedAt: "2026-08-21T09:00:00Z", releasesCompletedAt: "2026-08-21T09:10:00Z", submittedAt: null },
      draft: { locked: false, payload: COMPLETE_DRAFT, furthestSection: "review", updatedAt: null },
      esignConsent: { version: "v1", title: "t", citation: "c", body: "b", intent: "i", draft: false, required: true },
    }));
    const w = mountPage();
    await settle(w);
    expect(w.text()).toContain("Check your answers");

    fetchMock.mockResolvedValueOnce(ok({ ok: true, reviewRequestedAt: "2026-09-11T10:00:00Z" }));
    await advance(w);

    const sent = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/review"));
    expect(sent).toBeDefined();
    expect((sent?.[1] as RequestInit | undefined)?.method).toBe("POST");
    // ⚠ No body. The answers are already saved — a second copy arriving by another road is two
    // sources of truth for one application.
    expect((sent?.[1] as RequestInit | undefined)?.body).toBeUndefined();
    // And the driver is told it landed, rather than left on a form with a spent button.
    expect(w.text()).toContain("They have your application");
  });

  /**
   * A5/D-APP7 + D-APP4. The instruments are signed BEFORE the form: §391.21(b)'s certification is the
   * last act of an application, so anything that must happen with it happens first, or it needs a
   * second link — and a second touch is what loses people.
   */
  it("puts the signing ceremony between the consent and the form", async () => {
    fetchMock.mockResolvedValue(ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z",
      releases: RELEASES.map((r) => ({ ...r, version: "v1", draft: false })),
      releasesSigned: [],
      phases: { consentedAt: "2026-08-21T09:00:00Z", releasesCompletedAt: null, submittedAt: null },
      draft: { locked: false, payload: COMPLETE_DRAFT, furthestSection: null, updatedAt: null },
      esignConsent: {
        version: "v1", title: "t", citation: "c", body: "b", intent: "i", draft: false, required: true,
      },
      // AF3: identity already given, so the next thing is the first permission.
      identityComplete: true,
    }));
    const w = mountPage();
    await settle(w);

    // Adoption first, once.
    expect(w.text()).toContain("Your signature");
    expect(w.text()).toContain("Type your full name");
    // And the form is not reachable behind it.
    expect(w.text()).not.toContain(step(1));
  });

  /**
   * ⚠ AF3/D-AF1: the date of birth and licence come BEFORE the first permission. PSP, the driving
   * record and the Clearinghouse query run on them before the application exists, and the server
   * refuses a signature without them — so a page that went straight to the ceremony would walk the
   * applicant into a refusal on the first tap.
   */
  it("asks for the licence before the first permission when it is not on file", async () => {
    fetchMock.mockResolvedValue(ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z",
      releases: RELEASES.map((r) => ({ ...r, version: "v1", draft: false })),
      releasesSigned: [],
      phases: { consentedAt: "2026-08-21T09:00:00Z", releasesCompletedAt: null, submittedAt: null },
      draft: { locked: false, payload: null, furthestSection: null, updatedAt: null },
      esignConsent: {
        version: "v1", title: "t", citation: "c", body: "b", intent: "i", draft: false, required: true,
      },
      identityComplete: false,
    }));
    const w = mountPage();
    await settle(w);

    expect(w.text()).toContain("Your driver's licence");
    expect(w.text()).not.toContain("Your signature");
    expect(w.text()).not.toContain(step(1));
  });

  /**
   * C3a (§6.2): a v2 link — the server serves it a `partOne` — walks Part 1 where a legacy link is asked
   * its identity, because Part 1 writes the identity now. The discriminator is the legacy test above: the
   * same bundle without `partOne` still opens on the identity screen.
   */
  const partOnePage = (partOne: Record<string, unknown>, extra: Record<string, unknown> = {}) => ok({
    carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z",
    releases: RELEASES.map((r) => ({ ...r, version: "v1", draft: false })),
    releasesSigned: [],
    phases: { consentedAt: "2026-08-21T09:00:00Z", releasesCompletedAt: null, submittedAt: null, applicationSentAt: null },
    draft: { locked: false, payload: null, furthestSection: null, updatedAt: null },
    esignConsent: { version: "v1", title: "t", citation: "c", body: "b", intent: "i", draft: false, required: true },
    identityComplete: false,
    captures: [],
    partOne: {
      completedAt: null, contact: false, address: false, licences: false, screening: false,
      medicalCardPending: false, rights: false, ...partOne,
    },
    fcraSummary: null,
    ...extra,
  });

  it("walks a v2 link through Part 1 instead of the identity screen, before any permission", async () => {
    fetchMock.mockResolvedValue(partOnePage({}));
    const w = mountPage();
    await settle(w);
    // Step 1 is the CDL's front: its barcode (on the back) fills the typed screens after it (Q-AW31).
    expect(w.text()).toContain(APPLY_COPY.partOne.photo.cdl_front.heading);
    expect(w.text()).toContain(APPLY_COPY.partOne.step(1, PART_ONE_SCREENS.length));
    expect(w.text()).not.toContain("Your driver's licence");
    expect(w.text()).not.toContain("Your signature");
  });

  /**
   * §6.6.1: nothing uploads before "Use this photo". Continue with a photo taken and not sent would ask the
   * server, find the slot empty and say "Take the photo" to a driver looking at the photo they took — so it
   * names the button instead, and asks the server nothing.
   */
  it("Continue with a photo taken and not sent names Use this photo and asks the server nothing", async () => {
    fetchMock.mockResolvedValue(partOnePage({}));
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const w = mountPage();
    await settle(w);
    const press = async (label: string) => {
      await w.findAll("button").find((b) => b.text() === label)!.trigger("click");
      await flushPromises();
    };
    await press(APPLY_COPY.partOne.photo.take);
    const before = fetchMock.mock.calls.length;
    await press(APPLY_COPY.partOne.next);
    expect(w.text()).toContain(APPLY_COPY.partOne.photo.unsent);
    expect(w.text()).not.toContain(APPLY_COPY.partOne.photo.required);
    expect(fetchMock.mock.calls.length).toBe(before);
    expect(w.text()).toContain(APPLY_COPY.partOne.photo.cdl_front.heading);
  });

  /**
   * §6.6.6 (C3b2b2): on a computer the photo comes from the phone, through the same link. The desktop
   * tab re-reads the bundle while the slot is empty and moves on when the phone's photo is on it.
   */
  it("on a computer, moves on by itself when the phone's photo arrives", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      fetchMock.mockResolvedValue(partOnePage({}));
      const w = mountPage();
      await settle(w);
      expect(w.text()).toContain(APPLY_COPY.partOne.photo.handoff.heading);
      expect(w.text()).toContain(APPLY_COPY.partOne.photo.cdl_front.heading);

      await vi.advanceTimersByTimeAsync(10_000);
      await flushPromises();
      // Nothing yet: still waiting on the same screen.
      expect(w.text()).toContain(APPLY_COPY.partOne.photo.cdl_front.heading);

      fetchMock.mockResolvedValue(partOnePage({}, {
        captures: [{ slot: "cdl_front", contentType: "image/webp", bytes: 1, capturedAt: "2026-09-27T12:00:00Z" }],
      }));
      await vi.advanceTimersByTimeAsync(10_000);
      await flushPromises();
      expect(w.text()).toContain(APPLY_COPY.partOne.photo.cdl_back.heading);
      expect(w.text()).toContain(APPLY_COPY.partOne.step(2, PART_ONE_SCREENS.length));
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.stubGlobal("fetch", fetchMock);
    }
  });

  it("on a computer, follows the phone past a screen whose photo already arrived", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      fetchMock.mockResolvedValue(partOnePage({}));
      const w = mountPage();
      await settle(w);
      const both = ["cdl_front", "cdl_back"].map((slot) => ({ slot, contentType: "image/webp", bytes: 1, capturedAt: "2026-09-27T12:00:00Z" }));
      fetchMock.mockResolvedValue(partOnePage({}, { captures: both }));
      await vi.advanceTimersByTimeAsync(10_000);
      await flushPromises();
      // Both sides came from the phone: the desktop is carried past the CDL's back to the typed screens.
      expect(w.text()).toContain(APPLY_COPY.partOne.step(3, PART_ONE_SCREENS.length));
      expect(w.text()).toContain(APPLY_COPY.partOne.about.heading);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.stubGlobal("fetch", fetchMock);
    }
  });

  it("on a computer, a filled photo screen reached with Back stays put", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const front = [{ slot: "cdl_front", contentType: "image/webp", bytes: 1, capturedAt: "2026-09-27T12:00:00Z" }];
      fetchMock.mockResolvedValue(partOnePage({}, { captures: front }));
      const w = mountPage();
      await settle(w);
      // Resumed on the first screen still owed: the CDL's back.
      expect(w.text()).toContain(APPLY_COPY.partOne.photo.cdl_back.heading);
      await w.findAll("button").find((b) => b.text() === APPLY_COPY.partOne.back)!.trigger("click");
      await flushPromises();
      await vi.advanceTimersByTimeAsync(30_000);
      await flushPromises();
      // The driver went back to look; the page does not push them forward again.
      expect(w.text()).toContain(APPLY_COPY.partOne.photo.cdl_front.heading);
      expect(w.text()).toContain(APPLY_COPY.partOne.photo.receivedEarlier);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.stubGlobal("fetch", fetchMock);
    }
  });

  /**
   * C3c2a (§6.4, D-AW11): a v2 link's Part 2 opens on its task list, on every return — never mid-form —
   * and a task opened from it closes back to the list. The legacy page tests above walk the wizard, which
   * is the discriminator: the same page without `partOne` must not show the list.
   */
  it("opens a v2 link's Part 2 on its task list, and a task closes back to it", async () => {
    const part2 = { phases: {
      consentedAt: "2026-08-21T09:00:00Z", releasesCompletedAt: "2026-08-21T09:10:00Z",
      submittedAt: null, applicationSentAt: "2026-08-22T09:00:00Z",
    }, releasesSigned: [...APPLICATION_RELEASE_ORDER], draft: { locked: false, payload: COMPLETE_DRAFT, furthestSection: "safety", updatedAt: null } };
    fetchMock.mockResolvedValue(partOnePage({ completedAt: "2026-08-21T09:05:00Z" }, part2));
    const w = mountPage();
    await settle(w);
    const press = async (label: string) => {
      await w.findAll("button").find((b) => b.text().includes(label))!.trigger("click");
      await flushPromises();
    };
    expect(w.text()).toContain(APPLY_COPY.hub.heading);
    expect(w.text()).toContain(APPLY_COPY.hub.beforeYouSend);

    await press("About you");
    expect(w.text()).not.toContain(APPLY_COPY.hub.intro);
    expect(w.text()).toContain(APPLY_COPY.hub.saveAndContinue);
    await press(APPLY_COPY.hub.backToList);
    expect(w.text()).toContain(APPLY_COPY.hub.intro);

    // "Save and continue" on a task that passes closes it back to the LIST — not on to the next screen,
    // which is what the linear wizard's Next would do.
    await press("About you");
    await press(APPLY_COPY.hub.saveAndContinue);
    expect(w.text()).toContain(APPLY_COPY.hub.intro);
  });

  /**
   * C3c2b: the job panel asks a v2 link what its filing requires (Q-AW33's two questions among them) —
   * so the page must tell it the link is v2, with the carrier's day. The page is the only thing that
   * knows (`partOne`); a missing hand-off would give every v2 applicant the legacy panel, silently.
   */
  it("tells a v2 link's job panel the carrier's day, so it asks what the filing requires", async () => {
    const part2 = { phases: {
      consentedAt: "2026-08-21T09:00:00Z", releasesCompletedAt: "2026-08-21T09:10:00Z",
      submittedAt: null, applicationSentAt: "2026-08-22T09:00:00Z",
    }, releasesSigned: [...APPLICATION_RELEASE_ORDER], carrierToday: "2026-09-26",
    draft: { locked: false, payload: COMPLETE_DRAFT, furthestSection: "safety", updatedAt: null } };
    fetchMock.mockResolvedValue(partOnePage({ completedAt: "2026-08-21T09:05:00Z" }, part2));
    const w = mountPage();
    await settle(w);
    await w.findAll("button").find((b) => b.text().includes("Where you have worked"))!.trigger("click");
    await flushPromises();
    expect(w.findComponent(EmployerDrawer).props("v2AsOf")).toBe("2026-09-26");
  });

  /**
   * C3c2c2 (Q-AW34): a v2 link's Part 2 is behind the unlock, and the unlock is what releases Part 1's
   * facts — so after it the draft carries them (the document filing will compose) and "About you" shows
   * them rather than asking. The bare bundle carries none of them (D-APP16).
   */
  it("releases Part 1's facts with the unlock, lays them into the draft and shows them read-only", async () => {
    const FACTS = {
      intake: {
        phone: "+13125550142", address_line1: "1 Main St", address_line2: null, city: "Joliet", state: "IL",
        postal_code: "60431", prior_positive_2y: false, cdl_class: "A",
      },
      licences: [{ position: 0, state_code: "IL", agency: null, licence_number: "IL123", expires_on: "2029-03-01" }],
      asOf: "2026-09-26",
    };
    const bundle = partOnePage({ completedAt: "2026-08-21T09:05:00Z" }, {
      phases: {
        consentedAt: "2026-08-21T09:00:00Z", releasesCompletedAt: "2026-08-21T09:10:00Z",
        submittedAt: null, applicationSentAt: "2026-08-22T09:00:00Z",
      },
      releasesSigned: [...APPLICATION_RELEASE_ORDER], carrierToday: "2026-09-26",
      draft: { locked: true, payload: null, furthestSection: null, updatedAt: null },
    });
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith("/unlock")
        ? ok({ draft: { locked: false, payload: { ...COMPLETE_DRAFT, phone: "555-0000" }, furthestSection: "safety", updatedAt: null, partOne: FACTS } })
        : bundle);
    const w = mountPage();
    await settle(w);
    expect(w.text()).toContain(APPLY_COPY.unlock.heading);
    expect(w.text()).not.toContain("555-0142");

    w.findComponent({ name: "AppDateField" }).vm.$emit("update:modelValue", "1980-04-01");
    await settle(w);
    await w.findAll("button").find((b) => b.text().includes(APPLY_COPY.unlock.action))!.trigger("click");
    await settle(w);
    expect(w.text()).toContain(APPLY_COPY.hub.heading);

    await w.findAll("button").find((b) => b.text().includes("About you"))!.trigger("click");
    await flushPromises();
    expect(w.find("[data-part-one-facts]").text()).toContain("(312) 555-0142");
    expect(w.find("#apply-phone").exists()).toBe(false);
    // The draft is Part 1's now — the phone typed long ago replaced — so every screen, the review and
    // the send act read what filing will file.
    const section = w.findComponent(ApplySection);
    expect(section.props("modelValue").phone).toBe("+13125550142");
    expect(section.props("partOne")).toEqual(FACTS);
  });

  it("goes to the permissions once Part 1 is finished, and never back to the identity screen", async () => {
    fetchMock.mockResolvedValue(partOnePage({ completedAt: "2026-08-21T09:05:00Z" }));
    const w = mountPage();
    await settle(w);
    expect(w.text()).toContain("Your signature");
    expect(w.text()).not.toContain(APPLY_COPY.partOne.photo.cdl_front.heading);
    expect(w.text()).not.toContain("Your driver's licence");
  });

  /** §6.2 screen 20: the v2 "done" screen offers the Clearinghouse registration; a legacy one does not. */
  it("offers the Clearinghouse registration on a v2 link's permissions-received screen only", async () => {
    const received = { phases: { consentedAt: "2026-08-21T09:00:00Z", releasesCompletedAt: "2026-08-21T09:10:00Z", submittedAt: null, applicationSentAt: null } };
    fetchMock.mockResolvedValue(partOnePage({ completedAt: "2026-08-21T09:05:00Z" }, received));
    const v2 = mountPage();
    await settle(v2);
    expect(v2.text()).toContain(APPLY_COPY.permissionsReceived.heading);
    expect(v2.text()).toContain(APPLY_COPY.partOne.clearinghouse.heading);

    fetchMock.mockResolvedValue(partOnePage({}, { ...received, partOne: null }));
    const legacy = mountPage();
    await settle(legacy);
    expect(legacy.text()).toContain(APPLY_COPY.permissionsReceived.heading);
    expect(legacy.text()).not.toContain(APPLY_COPY.partOne.clearinghouse.heading);
  });

  /**
   * ⚠ And once it is on file the form SHOWS it and does not let it be retyped (D-AF8): the licence
   * PSP ran against is the licence the application must name. The discriminator is the pair — the
   * same page with the identity not on file must leave the field editable, or a field that was always
   * disabled would pass.
   */
  /**
   * §391.21(b)(1) (C3c1): "The name and address of the employing motor carrier" is ON the application —
   * the form shows the carrier's legal address the filed PDF prints, and says nothing where none is on file.
   */
  it("names the employing carrier and its address on the form", async () => {
    const formPage = (carrierAddress: string | null) => ok({
      carrier: "Silvicom Inc", carrierAddress, expiresAt: "2099-01-01T00:00:00Z",
      releases: RELEASES.map((r) => ({ ...r, version: "v1", draft: false })),
      releasesSigned: [...APPLICATION_RELEASE_ORDER],
      phases: { consentedAt: "2026-08-21T09:00:00Z", releasesCompletedAt: "2026-08-21T09:10:00Z", submittedAt: null },
      draft: { locked: false, payload: COMPLETE_DRAFT, furthestSection: null, updatedAt: null },
      esignConsent: { version: "v1", title: "t", citation: "c", body: "b", intent: "i", draft: false, required: true },
      identityComplete: false,
    });
    fetchMock.mockResolvedValue(formPage("1301 Armitage Ave, Melrose Park, IL 60160"));
    const w = mountPage();
    await settle(w);
    expect(w.text()).toContain(APPLY_COPY.page.employingCarrier("Silvicom Inc", "1301 Armitage Ave, Melrose Park, IL 60160"));
    w.unmount();

    fetchMock.mockResolvedValue(formPage(null));
    const none = mountPage();
    await settle(none);
    expect(none.text()).not.toContain("Employing carrier:");
  });

  it("shows the date of birth on the form and does not let it be retyped once on file", async () => {
    const formPage = (identityComplete: boolean) => ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z",
      releases: RELEASES.map((r) => ({ ...r, version: "v1", draft: false })),
      releasesSigned: [...APPLICATION_RELEASE_ORDER],
      phases: { consentedAt: "2026-08-21T09:00:00Z", releasesCompletedAt: "2026-08-21T09:10:00Z", submittedAt: null },
      draft: { locked: false, payload: COMPLETE_DRAFT, furthestSection: null, updatedAt: null },
      esignConsent: {
        version: "v1", title: "t", citation: "c", body: "b", intent: "i", draft: false, required: true,
      },
      identityComplete,
    });
    const dobDisabled = (w: ReturnType<typeof mountPage>) =>
      w.findAll("input").filter((i) => i.element.disabled).length;

    fetchMock.mockResolvedValue(formPage(true));
    const locked = mountPage();
    await settle(locked);
    expect(locked.text()).toContain("To change this, contact Silvicom Inc.");
    expect(dobDisabled(locked)).toBeGreaterThan(0);
    locked.unmount();

    fetchMock.mockResolvedValue(formPage(false));
    const open = mountPage();
    await settle(open);
    expect(open.text()).not.toContain("To change this, contact");
    expect(dobDisabled(open)).toBe(0);
  });

  /**
   * ⚠ AF4 (plan §3.1 row 5): the first visit ends with the permissions. The form is the office's to
   * send, the server refuses a draft before it is sent, and the screen says what happens next —
   * including that THIS link will be replaced, because sending rotates it.
   *
   * ⚠ Three cases, and the third is the discriminator: an API from before AF4 sends no
   * `applicationSentAt` at all, and a page reading `undefined` as "not sent" would strand every
   * applicant on this screen during a deploy.
   */
  it("waits for the office after the permissions, until the application is sent", async () => {
    const page = (applicationSentAt?: string | null) => ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z",
      releases: RELEASES.map((r) => ({ ...r, version: "v1", draft: false })),
      releasesSigned: [...APPLICATION_RELEASE_ORDER],
      phases: {
        consentedAt: "2026-08-21T09:00:00Z", releasesCompletedAt: "2026-08-21T09:10:00Z", submittedAt: null,
        ...(applicationSentAt === undefined ? {} : { applicationSentAt }),
      },
      draft: { locked: false, payload: COMPLETE_DRAFT, furthestSection: null, updatedAt: null },
      esignConsent: { version: "v1", title: "t", citation: "c", body: "b", intent: "i", draft: false, required: true },
      identityComplete: true,
    });

    fetchMock.mockResolvedValue(page(null));
    const waiting = mountPage();
    await settle(waiting);
    expect(waiting.text()).toContain("We have your permissions");
    expect(waiting.text()).toContain("this one will stop working");
    expect(waiting.text()).not.toContain(step(1));
    waiting.unmount();

    fetchMock.mockResolvedValue(page("2026-08-22T09:00:00Z"));
    const sent = mountPage();
    await settle(sent);
    expect(sent.text()).not.toContain("We have your permissions");
    expect(sent.text()).toContain(step(1));
    sent.unmount();

    fetchMock.mockResolvedValue(page(undefined));
    const olderApi = mountPage();
    await settle(olderApi);
    expect(olderApi.text()).toContain(step(1));
  });

  it("goes straight to the form when the ceremony is already finished", async () => {
    fetchMock.mockResolvedValue(ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z",
      releases: RELEASES.map((r) => ({ ...r, version: "v1", draft: false })),
      releasesSigned: ["fcra_disclosure", "psp"],
      phases: {
        consentedAt: "2026-08-21T09:00:00Z",
        releasesCompletedAt: "2026-08-21T09:10:00Z",
        submittedAt: null,
      },
      draft: { locked: false, payload: COMPLETE_DRAFT, furthestSection: null, updatedAt: null },
      esignConsent: {
        version: "v1", title: "t", citation: "c", body: "b", intent: "i", draft: false, required: true,
      },
    }));
    const w = mountPage();
    await settle(w);

    expect(w.text()).not.toContain("Your signature");
    expect(w.text()).toContain(step(1));
  });

  /**
   * Q-H3. While any instrument is draft the server refuses those signatures, so a ceremony gated on
   * them would be a wall across the application — it is skipped, and they are shown read-only at the
   * end as they were before A5, so nobody is asked weeks later to sign what they have never seen.
   */
  it("skips the ceremony while the wording is draft, and still shows the instruments", async () => {
    fetchMock.mockResolvedValue(ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES,
      releasesSigned: [],
      phases: { consentedAt: null, releasesCompletedAt: null, submittedAt: null },
      draft: { locked: false, payload: COMPLETE_DRAFT, furthestSection: null, updatedAt: null },
    }));
    const w = mountPage();
    await settle(w);

    expect(w.text()).not.toContain("Your signature");
    expect(w.text()).toContain(step(1));
    for (let i = 0; i < TOTAL - 1; i++) await advance(w);
    expect(w.text()).toContain("Not final");
    expect(w.text()).toContain("We may obtain your FMCSA crash and inspection history.");
  });

  /**
   * B7. What the whole thing involves, for somebody who has not started it.
   *
   * ⚠ It sits AHEAD of the consent gate, and that does not disturb D-APP5: A4's ruling is that
   * nothing is asked and nothing is written before the 7001(c) consent, and this screen does neither.
   * Behind the consent and the four signatures, it would be telling a driver the length of the form
   * after they had already signed five documents.
   */
  it("says what it involves before it asks for anything, on a link nobody has touched", async () => {
    fetchMock.mockResolvedValue(ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES,
      phases: { consentedAt: null, releasesCompletedAt: null, submittedAt: null },
      draft: { locked: false, payload: null, furthestSection: null, updatedAt: null },
      esignConsent: {
        version: "v1", title: "Agreeing to sign electronically", citation: "15 U.S.C. 7001(c)",
        body: "You do not have to do any of this electronically.",
        intent: "I agree.", draft: false, required: true,
      },
    }));
    const w = mountPage();
    await settle(w);

    expect(w.text()).toContain(APPLY_COPY.expectations.heading);
    // Neither the consent nor the form is behind it yet — one screen at a time, and this one first.
    expect(w.text()).not.toContain("You do not have to do any of this electronically.");
    expect(w.text()).not.toContain(step(1));

    await start(w);
    // And the consent is still what the link collects first.
    expect(w.text()).toContain("You do not have to do any of this electronically.");
    expect(w.text()).not.toContain(step(1));
  });

  /**
   * Every one of these means the same thing — that this person has started — and each is a separate
   * disjunct in `started`. A fixture that only ever varied the draft would pass with the other two
   * deleted, which is the shape of a test that proves nothing.
   */
  it.each([
    ["a draft with something typed into it", {
      phases: { consentedAt: null, releasesCompletedAt: null, submittedAt: null },
      draft: { locked: false, payload: { first_name: "Susan" }, furthestSection: null, updatedAt: null },
    }],
    ["a consent already given", {
      phases: { consentedAt: "2026-08-21T09:00:00Z", releasesCompletedAt: null, submittedAt: null },
      draft: { locked: false, payload: null, furthestSection: null, updatedAt: null },
    }],
    ["a ceremony abandoned part-way through", {
      phases: { consentedAt: null, releasesCompletedAt: null, submittedAt: null },
      draft: { locked: false, payload: null, furthestSection: null, updatedAt: null },
      releasesSigned: ["psp"],
    }],
  ])("does not explain the process again to somebody with %s", async (_case, link) => {
    fetchMock.mockResolvedValue(ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES, ...link,
    }));
    const w = mountPage();
    await settle(w);

    expect(w.text()).not.toContain(APPLY_COPY.expectations.heading);
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
    expect(w.text()).not.toContain(step(1));
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
    expect(w.text()).toContain(step(1));
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
    expect(w.text()).toContain(step(1));
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
    expect(w.text()).toContain(step(1));
    expect((w.find("input[autocomplete=\"given-name\"]").element as HTMLInputElement).value).toBe("Susan");
  });

  /**
   * X8/D-AX9. The 7001(c) consent this driver gave promises them a copy "at no charge", and until
   * now the only way to get one was to ask the carrier.
   */
  it("offers the driver their own copy once the application is in", async () => {
    fetchMock.mockResolvedValue(ok({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES,
      phases: { consentedAt: null, releasesCompletedAt: null, submittedAt: "2026-08-21T18:00:00Z" },
      draft: { locked: false, payload: null, furthestSection: null, updatedAt: null },
    }));
    const w = mountPage();
    await settle(w);

    expect(w.text()).toContain("Your application is in");
    expect(w.text()).toContain("Download your copy");
  });

  it("asks for a fresh link at the moment of the press, and opens it", async () => {
    // A signed URL is good for five minutes, so it is fetched when the button is pressed rather than
    // held on the page waiting to go stale.
    const open = vi.fn(() => ({}) as Window);
    vi.stubGlobal("open", open);
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith("/document")
        ? ok({ url: "https://storage.test/signed/app.pdf", filename: "driver-application.pdf", expiresInSeconds: 300 })
        : ok({
          carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES,
          phases: { consentedAt: null, releasesCompletedAt: null, submittedAt: "2026-08-21T18:00:00Z" },
          draft: { locked: false, payload: null, furthestSection: null, updatedAt: null },
        }));
    const w = mountPage();
    await settle(w);

    await w.findAll("button").find((b) => b.text().includes("Download your copy"))!.trigger("click");
    await settle(w);

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/document"), expect.anything());
    expect(open).toHaveBeenCalledWith("https://storage.test/signed/app.pdf", "_blank", "noopener");
  });

  it("names the other way to get the document when the link will not open", async () => {
    // A blocked popup and a failed fetch are indistinguishable here, and both leave the driver
    // needing the same next step.
    vi.stubGlobal("open", vi.fn(() => null));
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith("/document")
        ? ok({ url: "https://storage.test/signed/app.pdf", filename: "f.pdf", expiresInSeconds: 300 })
        : ok({
          carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES,
          phases: { consentedAt: null, releasesCompletedAt: null, submittedAt: "2026-08-21T18:00:00Z" },
          draft: { locked: false, payload: null, furthestSection: null, updatedAt: null },
        }));
    const w = mountPage();
    await settle(w);
    await w.findAll("button").find((b) => b.text().includes("Download your copy"))!.trigger("click");
    await settle(w);

    expect(w.text()).toContain("ask the carrier to send you a copy");
  });

  it("says one thing about a dead link, whatever killed it", async () => {
    fetchMock.mockResolvedValue(dead());
    const w = mountPage();
    await settle(w);
    expect(w.text()).toContain("This link is not valid");
    expect(w.text()).toContain("Ask the carrier who invited you for a new one");
  });

  /**
   * AW10 (C3d1b): Part 2's draft is saved against its revision, and what a visit could not send is kept
   * on the phone and put back on the next one — only onto the revision it was typed on, and never before
   * the date-of-birth unlock (D-APP16).
   */
  describe("the draft's revision and the copy on the phone", () => {
    const KEY = "a".repeat(64);
    const formBundle = (draft: Record<string, unknown>) => ({
      carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", localKey: KEY,
      releases: RELEASES.map((r) => ({ ...r, version: "v1", draft: false })),
      releasesSigned: ["fcra_disclosure", "psp"],
      phases: { consentedAt: "2026-08-21T09:00:00Z", releasesCompletedAt: "2026-08-21T09:10:00Z", submittedAt: null },
      draft,
      esignConsent: { version: "v1", title: "t", citation: "c", body: "b", intent: "i", draft: false, required: true },
    });
    /** What the phone kept last time: the complete draft, with the email changed. */
    const PHONE = JSON.parse(JSON.stringify(toDraftPayload({ ...fromDraftPayload(COMPLETE_DRAFT), email: "phone@example.test" })));
    const keep = (baseRevision: number) => writeDraftCopy({
      key: KEY, version: DRAFT_COPY_VERSION, payload: PHONE, section: null, baseRevision,
      savedAt: "2026-09-28T10:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z",
    });
    const puts = () => fetchMock.mock.calls
      .filter(([url, init]) => String(url).endsWith("/draft") && init?.method === "PUT")
      .map(([, init]) => JSON.parse(String(init.body)) as { payload: Record<string, unknown>; revision?: number });
    const route = (bundle: unknown, draftAnswer: () => unknown = () => ok({ ok: true, updatedAt: "2026-09-28T10:01:00Z", revision: 6 })) =>
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
        String(url).endsWith("/draft") && init?.method === "PUT" ? draftAnswer() : ok(bundle));

    beforeEach(() => {
      globalThis.indexedDB = new IDBFactory();
    });

    it("puts back what the phone could not send, onto the revision it was typed on, and sends it at once", async () => {
      await keep(5);
      route(formBundle({ locked: false, payload: COMPLETE_DRAFT, furthestSection: null, updatedAt: null, revision: 5 }));
      const w = mountPage();
      await settle(w);
      expect(w.text()).toContain(APPLY_COPY.save.restored);
      expect(puts()).toHaveLength(1);
      expect(puts()[0]).toMatchObject({ revision: 5, payload: { email: "phone@example.test" } });
      w.unmount();
    });

    it("drops a copy the server moved on from, says so, and sends nothing", async () => {
      await keep(4);
      route(formBundle({ locked: false, payload: COMPLETE_DRAFT, furthestSection: null, updatedAt: null, revision: 5 }));
      const w = mountPage();
      await settle(w);
      expect(w.text()).toContain(APPLY_COPY.save.dropped);
      expect(puts()).toHaveLength(0);
      expect(await readDraftCopy(KEY)).toBeNull();
      w.unmount();
    });

    it("stops saving and offers the reload when the server says the draft changed elsewhere", async () => {
      await keep(5);
      route(
        formBundle({ locked: false, payload: COMPLETE_DRAFT, furthestSection: null, updatedAt: null, revision: 5 }),
        () => ({ ok: false, json: async () => ({ error: { code: "draft_revision_conflict", message: "changed" } }) }),
      );
      const w = mountPage();
      await settle(w);
      expect(w.text()).toContain(APPLY_COPY.save.conflictDetail);
      expect(w.findAll("button").some((b) => b.text() === APPLY_COPY.save.reload)).toBe(true);
      expect(await readDraftCopy(KEY)).toBeNull();
      w.unmount();
    });

    it("never puts a copy back on a locked draft before the date of birth, and uses the unlock's revision after it", async () => {
      await keep(8);
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith("/unlock")) {
          return ok({ draft: { locked: false, payload: COMPLETE_DRAFT, furthestSection: null, updatedAt: null, revision: 8 } });
        }
        if (String(url).endsWith("/draft") && init?.method === "PUT") return ok({ ok: true, updatedAt: "x", revision: 9 });
        // The bundle was read a save earlier than the unlock: the body's own revision is the one to save against.
        return ok(formBundle({ locked: true, payload: null, furthestSection: null, updatedAt: null, revision: 7 }));
      });
      const w = mountPage();
      await settle(w);
      expect(w.text()).toContain(APPLY_COPY.unlock.heading);
      expect(w.text()).not.toContain(APPLY_COPY.save.restored);
      expect(puts()).toHaveLength(0);

      w.findComponent({ name: "AppDateField" }).vm.$emit("update:modelValue", "1980-04-01");
      await settle(w);
      await w.findAll("button").find((b) => b.text().includes(APPLY_COPY.unlock.action))!.trigger("click");
      await settle(w);
      expect(w.text()).toContain(APPLY_COPY.save.restored);
      expect(puts()[0]).toMatchObject({ revision: 8, payload: { email: "phone@example.test" } });
      w.unmount();
    });
  });

  /**
   * C3d2 (Q-AW38 (a)): the page provides the link's copy spec, and Part 1's photo screen — four components
   * down — sends a photograph a previous visit chose and never got confirmed, without a retake.
   */
  it("sends a photograph kept from the last visit when Part 1's photo screen opens, and lets it go once confirmed", async () => {
    globalThis.indexedDB = new IDBFactory();
    const KEY = "b".repeat(64);
    const spec = { key: KEY, linkExpiresAt: "2099-01-01T00:00:00Z" };
    await keepPhoto(spec, "cdl_front", new Blob(["kept licence"]), "image/webp", "c3".repeat(32));
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:put-back";
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const calls: string[] = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/capture") && init?.method === "POST") {
        calls.push("start");
        return ok({ captureId: "cap-9", storagePath: "p", uploadUrl: "https://storage.test/u", uploadToken: "t" });
      }
      if (u === "https://storage.test/u") {
        calls.push("upload");
        return ok({});
      }
      if (u.endsWith("/capture/cap-9")) {
        calls.push(`confirm ${JSON.parse(String(init?.body)).sha256}`);
        return ok({ slot: "cdl_front", capturedAt: "2026-09-28T12:00:00Z" });
      }
      return partOnePage({}, { localKey: KEY });
    });
    const w = mountPage();
    await settle(w);
    await vi.waitFor(() => expect(calls).toEqual(["start", "upload", `confirm ${"c3".repeat(32)}`]));
    await vi.waitFor(async () => expect(await readKeptPhoto(spec, "cdl_front")).toBeNull());
  });

  /**
   * The screen reports (AW14, C3d3a), from the real page: each branch of the phase chain names itself
   * and the form names its section, so what §6.8 measures is what the driver actually had on screen.
   */
  describe("the screen reports", () => {

    /** Every report the page sent, as the screens they name, in order. */
    const reportsOf = (bundle: unknown) => {
      const screens: string[] = [];
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith("/screen-events")) {
          screens.push(...(JSON.parse(String(init!.body)) as { events: { screen: string }[] }).events.map((e) => e.screen));
          return ok({ ok: true });
        }
        return bundle;
      });
      return screens;
    };
    const close = async (w: ReturnType<typeof mountPage>) => {
      window.dispatchEvent(new Event("pagehide"));
      await settle(w);
    };

    it("names Part 1's screen, not only the branch it sits in", async () => {
      const screens = reportsOf(partOnePage({}));
      const w = mountPage();
      await settle(w);
      await close(w);
      expect(screens).toEqual(["part1.cdl_front"]);
    });

    it("names a v2 link's task list, then the task opened from it", async () => {
      const screens = reportsOf(partOnePage({ completedAt: "2026-08-21T09:05:00Z" }, {
        phases: {
          consentedAt: "2026-08-21T09:00:00Z", releasesCompletedAt: "2026-08-21T09:10:00Z",
          submittedAt: null, applicationSentAt: "2026-08-22T09:00:00Z",
        },
        releasesSigned: [...APPLICATION_RELEASE_ORDER],
        draft: { locked: false, payload: COMPLETE_DRAFT, furthestSection: "safety", updatedAt: null },
      }));
      const w = mountPage();
      await settle(w);
      await w.findAll("button").find((b) => b.text().includes("About you"))!.trigger("click");
      await settle(w);
      await close(w);
      expect(screens).toEqual(["part2.hub", "part2.identity"]);
    });

    it("names the wait for the office to send the form", async () => {
      const screens = reportsOf(partOnePage({ completedAt: "2026-08-21T09:05:00Z" }, {
        phases: {
          consentedAt: "2026-08-21T09:00:00Z", releasesCompletedAt: "2026-08-21T09:10:00Z",
          submittedAt: null, applicationSentAt: null,
        },
        releasesSigned: [...APPLICATION_RELEASE_ORDER],
      }));
      const w = mountPage();
      await settle(w);
      await close(w);
      expect(screens).toEqual(["wait.permissions"]);
    });

    it("names the handbook while its places are being signed, and the filed page around it", async () => {
      const filed = (openedAt: string | null) => ok({
        carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES,
        phases: { consentedAt: "2026-08-21T09:00:00Z", releasesCompletedAt: "2026-08-21T09:10:00Z", submittedAt: "2026-08-25T09:00:00Z" },
        handbook: {
          canOpen: true, openedAt, driverSigned: [], driverComplete: false, filedAt: null, adoption: null, version: "h1",
        },
      });
      let screens = reportsOf(filed("2026-08-26T09:00:00Z"));
      let w = mountPage();
      await settle(w);
      await close(w);
      expect(screens).toEqual(["handbook"]);
      w.unmount();

      screens = reportsOf(filed(null));
      w = mountPage();
      await settle(w);
      await close(w);
      expect(screens).toEqual(["filed"]);
    });

    it("names the screen the driver is on, from the first screen down to the form's section", async () => {
      const reports: { events: { screen: string; left_at: string | null }[] }[] = [];
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith("/screen-events")) {
          reports.push(JSON.parse(String(init!.body)) as (typeof reports)[number]);
          return ok({ ok: true, inserted: 1, closed: 0 });
        }
        return ok({
          carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES,
          draft: { locked: false, payload: COMPLETE_DRAFT, furthestSection: null, updatedAt: null },
        });
      });
      const w = mountPage();
      await settle(w);
      // A draft on file counts as a used link, so this one opens on the form rather than the welcome.
      await advance(w);
      window.dispatchEvent(new Event("pagehide"));
      await settle(w);

      expect(String(fetchMock.mock.calls.find(([u]) => String(u).endsWith("/screen-events"))![0]))
        .toBe(`/api/public/application/${"t".repeat(43)}/screen-events`);
      const visits = reports.flatMap((r) => r.events);
      expect(visits.map((v) => v.screen)).toEqual(["part2.identity", "part2.addresses"]);
      expect(visits.every((v) => v.left_at !== null)).toBe(true);
    });

    it("names the welcome and the consent on an untouched link", async () => {
      const reports: { events: { screen: string }[] }[] = [];
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith("/screen-events")) {
          reports.push(JSON.parse(String(init!.body)) as (typeof reports)[number]);
          return ok({ ok: true });
        }
        return ok({
          carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES,
          esignConsent: { version: "v1", title: "t", citation: "c", body: "b", intent: "i", draft: false, required: true },
        });
      });
      const w = mountPage();
      await settle(w);
      await start(w);
      window.dispatchEvent(new Event("pagehide"));
      await settle(w);
      expect(reports.flatMap((r) => r.events).map((v) => v.screen)).toEqual(["expectations", "consent"]);
    });
  });
});
