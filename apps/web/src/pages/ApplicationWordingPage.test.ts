import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import { ESIGN_CONSENT_CLAUSES, ESIGN_CONSENT_CLAUSE_LABELS } from "@silvicom/shared";

/**
 * Publishing the wording an applicant signs (0338).
 *
 * ⚠ What is worth pinning is not that a form renders. It is the two things this screen is the last
 * chance to get right: that the office is told, in one number, that nothing works until they publish;
 * and that the 7001(c) consent is asked for as SIX statutory clauses rather than one box, because a
 * consent missing 7001(c)(1)(B)(i)(I) is not a consent and the applicant's screen renders whatever
 * it is given.
 */

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));
vi.mock("@/components/ui/PageHeader.vue", () => ({ default: { template: "<div />" } }));

const ApplicationWordingPage = (await import("@/pages/ApplicationWordingPage.vue")).default;

const instrument = (over: Record<string, unknown> = {}) => ({
  instrument: "psp",
  version: "v0-draft",
  title: "FMCSA Pre-Employment Screening Program",
  intent: "I authorize the carrier to obtain my PSP record.",
  body: "Our placeholder PSP wording.",
  clauses: null,
  published: false,
  ...over,
});

const consent = (over: Record<string, unknown> = {}) =>
  instrument({
    instrument: "esign_consent",
    title: "Signing electronically",
    body: null,
    clauses: Object.fromEntries(ESIGN_CONSENT_CLAUSES.map((c) => [c, `placeholder ${c}`])),
    ...over,
  });

const view = (over: Record<string, unknown> = {}) => ({
  instruments: [instrument(), consent()],
  outstanding: ["psp", "esign_consent"],
  outstandingCount: 2,
  history: [],
  ...over,
});

const page = () =>
  mount(ApplicationWordingPage, { global: { plugins: [VueQueryPlugin, createPinia()] } });

const settle = async (w: ReturnType<typeof page>) => {
  for (let i = 0; i < 10; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};

const button = (w: ReturnType<typeof page>, label: string) =>
  w.findAll("button").find((b) => b.text().trim().startsWith(label));

beforeEach(() => {
  setActivePinia(createPinia());
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ ok: true, data: view() });
});

describe("what the office is told first", () => {
  it("leads with the count, and says what it costs", async () => {
    // The only number on the screen anybody can act on. Until it is zero, nothing an applicant does
    // works — not sending the form, not signing, not a PSP order.
    const w = page();
    await settle(w);
    expect(w.text()).toContain("2 of 2 documents still use our placeholder wording");
    expect(w.text()).toContain("cannot send their application or sign anything");
  });

  it("says so plainly once everything is published", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      data: view({
        instruments: [instrument({ published: true, version: "v1" }), consent({ published: true, version: "v1" })],
        outstanding: [],
        outstandingCount: 0,
      }),
    });
    const w = page();
    await settle(w);
    expect(w.text()).toContain("Applicants can sign and send");
    expect(w.text()).toContain("Live · v1");
  });

  it("shows the text a driver would meet today, not an empty box", async () => {
    const w = page();
    await settle(w);
    expect(w.text()).toContain("Our placeholder PSP wording.");
  });
});

describe("publishing", () => {
  it("⚠ asks for the consent as six statutory clauses, never as one block of text", async () => {
    const w = page();
    await settle(w);
    // The consent's own editor — opened from its card.
    const open = w.findAll("button").filter((b) => b.text().includes("Review and publish"));
    await open[1]!.trigger("click");
    await settle(w);

    // Each by the words the office reads, not by its key — the screen shows
    // `ESIGN_CONSENT_CLAUSE_LABELS`, and asserting on the slug would pass while showing nothing.
    for (const clause of ESIGN_CONSENT_CLAUSES) {
      expect(w.text()).toContain(ESIGN_CONSENT_CLAUSE_LABELS[clause]);
    }
    // Six clause boxes plus the intent — and no single "the wording" field for this instrument.
    expect(w.findAll("textarea").length).toBeGreaterThanOrEqual(ESIGN_CONSENT_CLAUSES.length);
  });

  it("sends the body for an authorization and the clauses for the consent", async () => {
    const w = page();
    await settle(w);
    await button(w, "Review and publish")!.trigger("click");
    await settle(w);

    apiFetch.mockResolvedValueOnce({ ok: true, data: { version: "v1" } });
    await button(w, "Publish")!.trigger("click");
    await settle(w);

    const call = apiFetch.mock.calls.find((c) => c[1]?.method === "POST");
    expect(call?.[0]).toBe("/api/recruitment/wording");
    // ⚠ The object, never a JSON string — `apiFetch` serialises it, and a double-encoded body is
    // refused by express and shows as a generic 500 with no audit row.
    expect(typeof call?.[1].body).toBe("object");
    expect(call?.[1].body.instrument).toBe("psp");
    expect(call?.[1].body.body).toContain("placeholder PSP wording");
    expect(call?.[1].body.clauses).toBeUndefined();
  });

  it("never sends a version — the server assigns it", async () => {
    const w = page();
    await settle(w);
    await button(w, "Review and publish")!.trigger("click");
    await settle(w);
    apiFetch.mockResolvedValueOnce({ ok: true, data: { version: "v1" } });
    await button(w, "Publish")!.trigger("click");
    await settle(w);

    const call = apiFetch.mock.calls.find((c) => c[1]?.method === "POST");
    expect(call?.[1].body.version).toBeUndefined();
  });

  it("leaves what is live alone when the editor is cancelled", async () => {
    const w = page();
    await settle(w);
    await button(w, "Review and publish")!.trigger("click");
    await settle(w);
    await button(w, "Cancel")!.trigger("click");
    await settle(w);

    expect(apiFetch.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);
    expect(w.text()).toContain("Our placeholder PSP wording.");
  });

  it("says what the server refused, rather than a generic failure", async () => {
    // The refusal that matters: a consent missing one of its six parts, named.
    const w = page();
    await settle(w);
    const open = w.findAll("button").filter((b) => b.text().includes("Review and publish"));
    await open[1]!.trigger("click");
    await settle(w);

    apiFetch.mockResolvedValueOnce({
      ok: false,
      error: { message: "The law requires all six parts of this consent. Still empty: paper_copy." },
    });
    await button(w, "Publish")!.trigger("click");
    await settle(w);

    // The editor stays open — the office has something to fix, not something to retry blindly.
    expect(w.findAll("textarea").length).toBeGreaterThan(0);
  });
});

/**
 * A proper source, offered rather than applied (2026-09-13).
 *
 * ⚠ What is worth pinning is the RESTRAINT. Three of these instruments were written by the carrier's
 * lawyers and sit on pages 14, 19 and 21 of their own packet; the fourth, PSP, is FMCSA's own
 * mandatory form. Publishing our placeholder instead would give one driver's file two texts for one
 * instrument, or — for PSP — breach the account-holder agreement. So the button exists, and it fills
 * the editor and stops. A version of this that published on click, or that pre-loaded the text
 * silently, would be the defect.
 */
describe("the instrument's proper source", () => {
  const packet = {
    kind: "packet" as const,
    title: "FAIR CREDIT REPORTING ACT DISCLOSURE",
    body: "The Federal Motor Carrier Safety Regulations (FMCSR) require motor carriers to investigate.",
    intent: "I hereby authorize SILVICOM, INC to obtain consumer reports.",
    provenance: "Your own wording, from page 19 of your application packet, spelling corrected.",
  };
  const withPacket = () =>
    view({ instruments: [instrument({ instrument: "fcra_disclosure", source: packet })], outstanding: ["fcra_disclosure"], outstandingCount: 1 });

  it("tells the office their own text exists, and which page it is on", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: withPacket() });
    const w = page();
    await settle(w);
    expect(w.text()).toContain("page 19 of your application packet");
  });

  /**
   * ⚠ PSP reads differently on purpose. The carrier's packet pages are theirs to adopt; FMCSA's
   * disclosure is not theirs at all, and an office that thinks it is optional will eventually
   * shorten it and lose their PSP access. The label and the sentence beside it have to say so.
   */
  it("says out loud that the PSP wording is the regulator's and not optional", async () => {
    const fmcsa = {
      kind: "fmcsa" as const,
      title: "IMPORTANT DISCLOSURE REGARDING BACKGROUND REPORTS FROM THE PSP Online Service",
      body: "In connection with your application for employment with Silvicom Inc…",
      intent: "I have read the above Disclosure Regarding Background Reports…",
      provenance:
        "FMCSA publishes this disclosure and requires account holders to use it in whole, exactly "
        + "as provided, as a stand-alone document.",
    };
    apiFetch.mockResolvedValue({ ok: true, data: view({ instruments: [instrument({ source: fmcsa })] }) });
    const w = page();
    await settle(w);
    expect(w.text()).toContain("in whole, exactly as provided");
    await button(w, "Review and publish")!.trigger("click");
    await settle(w);
    expect(button(w, "Use the FMCSA wording")).toBeDefined();
    // And never dressed up as the carrier's own choice.
    expect(button(w, "Use our packet's wording")).toBeUndefined();
  });

  it("does NOT pre-load it — the editor still opens on what is live", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: withPacket() });
    const w = page();
    await settle(w);
    await button(w, "Review and publish")!.trigger("click");
    await settle(w);
    expect((w.find("textarea").element as HTMLTextAreaElement).value).toContain("Our placeholder PSP wording.");
  });

  it("loads the packet text on request, and publishes THAT", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: withPacket() });
    const w = page();
    await settle(w);
    await button(w, "Review and publish")!.trigger("click");
    await settle(w);
    await button(w, "Use our packet's wording")!.trigger("click");
    await settle(w);

    apiFetch.mockResolvedValueOnce({ ok: true, data: { version: "v1" } });
    await button(w, "Publish")!.trigger("click");
    await settle(w);

    const post = apiFetch.mock.calls.find((c) => c[1]?.method === "POST")!;
    expect(post[1].body).toMatchObject({
      instrument: "fcra_disclosure",
      title: packet.title,
      body: packet.body,
      intent: packet.intent,
    });
    // ⚠ Still no version. The server assigns it — the packet does not get to name one either.
    expect(post[1].body).not.toHaveProperty("version");
  });

  it("offers nothing for an instrument the packet has no text for", async () => {
    // PSP is the one that matters: the carrier's lawyers never wrote it, and a button implying they
    // had would be the product telling a comfortable lie about where the words came from.
    apiFetch.mockResolvedValue({ ok: true, data: view({ instruments: [instrument({ source: null })] }) });
    const w = page();
    await settle(w);
    await button(w, "Review and publish")!.trigger("click");
    await settle(w);
    expect(button(w, "Use our packet's wording")).toBeUndefined();
    expect(w.text()).not.toContain("of your application packet");
  });
});
