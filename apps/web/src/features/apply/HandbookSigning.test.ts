import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import type { LinkHandbookStatus } from "@silvicom/shared";
import HandbookSigning from "./HandbookSigning.vue";
import { APPLY_COPY } from "./strings";

/**
 * The handbook on the applicant's link (HANDBOOK-SIGNING-PLAN.md HB4), walked one place at a time as
 * the envelope's last places (D-AW16, C3s4b). ⚠ The viewer is stubbed — `PermissionDocumentView` has its
 * own tests — so these pin what THIS component decides: which state shows, which place a press signs,
 * and where the count stands.
 */
vi.mock("@/features/apply/signing/PermissionDocumentView.vue", () => ({
  default: { name: "PermissionDocumentView", props: ["src", "label"], template: "<div data-viewer :data-src='src' />" },
}));

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", fetchMock);
const TOKEN = "t".repeat(43);

const status = (over: Partial<LinkHandbookStatus> = {}): LinkHandbookStatus => ({
  canOpen: true, openedAt: null, driverSigned: [], driverComplete: false, filedAt: null,
  version: "handbook-test-v1", ...over,
});
/** A company driver's packet since D-AW16 withdrew p25: 14 places, so the envelope is 19. */
const PACKET = 14;
const mountIt = (handbook: LinkHandbookStatus) =>
  mount(HandbookSigning, {
    props: { token: TOKEN, carrier: "Silvicom Inc", handbook, packetPlaces: PACKET },
    global: { plugins: [VueQueryPlugin] },
  });
const signButtons = (w: ReturnType<typeof mountIt>) => w.findAll("button").filter((b) => b.text() === APPLY_COPY.handbook.sign);

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ ok: true }) });
});

describe("walking its places (D-AW16, C3s4b)", () => {
  it("shows the handbook, re-reads it by the count of places signed, and continues the packet's count", async () => {
    const w = mountIt(status({ openedAt: "t", driverSigned: ["h1", "h2"] }));
    await flushPromises();
    expect(w.find("[data-viewer]").attributes("data-src")).toBe(`/api/public/application/${TOKEN}/handbook.pdf?v=2`);
    // 14 packet places, then h1 and h2: this is the envelope's 17th of 19.
    expect(w.text()).toContain("Place 17 of 19");
  });

  it("shows ONE place — the first unsigned — with its sentence and one button", async () => {
    const w = mountIt(status({ openedAt: "t", driverSigned: ["h1", "h2"] }));
    await flushPromises();
    expect(signButtons(w)).toHaveLength(1);
    expect(w.text()).toContain("By signing this, I agree to safety penalty policy.");
    expect(w.text()).not.toContain("I, Driver, have read the following rules");
  });

  it("signs the place shown, with the e-sign consent and no name typed, then moves on without waiting for a refetch", async () => {
    const w = mountIt(status({ openedAt: "t", driverSigned: ["h1", "h2"] }));
    await flushPromises();
    await signButtons(w)[0]!.trigger("click");
    await flushPromises();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/public/application/${TOKEN}/handbook/mark`);
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ placement_id: "h3", esign_consent: true, handbook_version: "handbook-test-v1" });
    expect(w.text()).toContain("Place 18 of 19");
    expect(w.text()).toContain("I, Driver, have read the following rules");
  });

  it("walks the places in the handbook's order, never the order the server listed them", async () => {
    const w = mountIt(status({ openedAt: "t", driverSigned: ["h4", "h1"] }));
    await flushPromises();
    await signButtons(w)[0]!.trigger("click");
    await flushPromises();
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)).placement_id).toBe("h2");
  });

  it("moves on from a place the server says is already signed, rather than refusing the driver", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: { code: "handbook_place_already_signed", message: "x" } }) });
    const w = mountIt(status({ openedAt: "t" }));
    await flushPromises();
    await signButtons(w)[0]!.trigger("click");
    await flushPromises();
    expect(w.text()).not.toContain(APPLY_COPY.handbook.signFailed);
    expect(w.text()).toContain("Place 16 of 19");
  });

  it("says so when a signature does not go through, and stays on the same place", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: { code: "handbook_not_opened", message: "x" } }) });
    const w = mountIt(status({ openedAt: "t" }));
    await flushPromises();
    await signButtons(w)[0]!.trigger("click");
    await flushPromises();
    expect(w.text()).toContain(APPLY_COPY.handbook.signFailed);
    expect(w.text()).toContain("Place 15 of 19");
  });

  it("tells the driver the carrier countersigns next once every place is signed", async () => {
    const w = mountIt(status({ openedAt: "t", driverSigned: ["h1", "h2", "h3", "h4", "h5"], driverComplete: true }));
    await flushPromises();
    expect(w.text()).toContain("Silvicom Inc countersigns it now");
    expect(signButtons(w)).toHaveLength(0);
  });
});

/** D-AW15 (C3s2a): the handbook signs with the link's adoption — C0b's own adoption screen is gone. */
describe("signing with the adopted signature", () => {
  it("goes straight to the places, and shows the server's sentence when the signature changed mid-document", async () => {
    const w = mountIt(status({ openedAt: "t" }));
    await flushPromises();
    expect(signButtons(w)).toHaveLength(1);
    fetchMock.mockResolvedValue({
      ok: false, status: 409,
      json: async () => ({ error: { code: "adoption_changed_mid_document", message: "Carry on with the one you started it with." } }),
    });
    await signButtons(w)[0]!.trigger("click");
    await flushPromises();
    expect(w.text()).toContain("Carry on with the one you started it with.");
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
