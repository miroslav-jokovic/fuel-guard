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

const ok = (body: unknown) => ({ ok: true, json: async () => body });
const dead = () => ({ ok: false, json: async () => ({ error: { code: "invalid_link", message: "This application link is not valid. Ask for a new one." } }) });

const mountPage = () =>
  mount(ApplyPage, { global: { plugins: [VueQueryPlugin] } });

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

  it("shows the carrier's name and the disclosure wording the server served", async () => {
    fetchMock.mockResolvedValue(ok({ carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES }));
    const w = mountPage();
    await settle(w);

    expect(w.text()).toContain("Silvicom Inc");
    expect(w.text()).toContain("We may obtain your FMCSA crash and inspection history.");
  });

  /** Read-only: marked as not final, and with nothing on the page that could record a signature. */
  it("presents draft disclosures as unsignable", async () => {
    fetchMock.mockResolvedValue(ok({ carrier: "Silvicom Inc", expiresAt: "2099-01-01T00:00:00Z", releases: RELEASES }));
    const w = mountPage();
    await settle(w);

    expect(w.text()).toContain("Not final");
    expect(w.text()).toContain("nothing here is being signed today");
    // The only checkbox on the page is the §391.21(b) certification of the application itself.
    const checkboxLabels = w.findAll("label").map((l) => l.text()).join(" ");
    expect(checkboxLabels).not.toContain("I authorize");
  });

  it("says one thing about a dead link, whatever killed it", async () => {
    fetchMock.mockResolvedValue(dead());
    const w = mountPage();
    await settle(w);
    expect(w.text()).toContain("This link is not valid");
    expect(w.text()).toContain("Ask the carrier who invited you for a new one");
  });
});
