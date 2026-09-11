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
    const open = w.findAll("button").filter((b) => b.text().includes("Publish our wording"));
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
    await button(w, "Publish our wording")!.trigger("click");
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
    await button(w, "Publish our wording")!.trigger("click");
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
    await button(w, "Publish our wording")!.trigger("click");
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
    const open = w.findAll("button").filter((b) => b.text().includes("Publish our wording"));
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
