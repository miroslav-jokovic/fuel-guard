import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import type { HandbookStatus } from "@silvicom/shared";
import HandbookSigning from "./HandbookSigning.vue";
import { APPLY_COPY } from "./strings";

/**
 * The handbook on the applicant's link (HANDBOOK-SIGNING-PLAN.md HB4). ⚠ The viewer is stubbed —
 * `PermissionDocumentView` has its own tests — so these pin what THIS component decides: which state
 * shows, which place a press signs, and that nothing polls.
 */
vi.mock("@/features/apply/signing/PermissionDocumentView.vue", () => ({
  default: { name: "PermissionDocumentView", props: ["src", "label"], template: "<div data-viewer :data-src='src' />" },
}));

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", fetchMock);
const TOKEN = "t".repeat(43);

const status = (over: Partial<HandbookStatus> = {}): HandbookStatus => ({
  canOpen: true, openedAt: null, driverSigned: [], driverComplete: false, filedAt: null, ...over,
});
const mountIt = (handbook: HandbookStatus) =>
  mount(HandbookSigning, { props: { token: TOKEN, carrier: "Silvicom Inc", handbook }, global: { plugins: [VueQueryPlugin] } });

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ ok: true }) });
});

describe("before the office opens it", () => {
  it("says where it happens and offers to look again, and fetches nothing by itself", async () => {
    const w = mountIt(status());
    await flushPromises();
    expect(w.text()).toContain("They open it for signing in their office");
    expect(w.find("[data-viewer]").exists()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("while it is open", () => {
  it("shows the handbook, and re-reads it by the count of places signed", async () => {
    const w = mountIt(status({ openedAt: "t", driverSigned: ["h1", "h2"] }));
    await flushPromises();
    expect(w.find("[data-viewer]").attributes("data-src")).toBe(`/api/public/application/${TOKEN}/handbook.pdf?v=2`);
    expect(w.text()).toContain("2 of 5 places signed.");
  });

  it("signs the place pressed, with the e-sign consent and no name typed", async () => {
    const w = mountIt(status({ openedAt: "t", driverSigned: ["h1", "h2"] }));
    await flushPromises();
    const next = w.findAll("button").find((b) => b.text() === APPLY_COPY.handbook.sign)!;
    await next.trigger("click");
    await flushPromises();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/public/application/${TOKEN}/handbook/mark`);
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ placement_id: "h3", esign_consent: true });
  });

  it("says so when a signature does not go through", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: { code: "handbook_not_opened", message: "x" } }) });
    const w = mountIt(status({ openedAt: "t" }));
    await flushPromises();
    await w.findAll("button").find((b) => b.text() === APPLY_COPY.handbook.sign)!.trigger("click");
    await flushPromises();
    expect(w.text()).toContain(APPLY_COPY.handbook.signFailed);
  });

  it("tells the driver the carrier countersigns next once every place is signed", async () => {
    const w = mountIt(status({ openedAt: "t", driverSigned: ["h1", "h2", "h3", "h4", "h5"], driverComplete: true }));
    await flushPromises();
    expect(w.text()).toContain("Silvicom Inc countersigns it now");
    expect(w.findAll("button").some((b) => b.text() === APPLY_COPY.handbook.sign)).toBe(false);
  });
});

describe("once it is filed", () => {
  it("offers their signed copy instead of the places", async () => {
    const w = mountIt(status({ openedAt: "t", driverComplete: true, filedAt: "t2" }));
    await flushPromises();
    expect(w.text()).toContain(APPLY_COPY.handbook.download);
    expect(w.find("[data-viewer]").exists()).toBe(false);
  });
});
