import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ApplicationFiledCard from "./ApplicationFiledCard.vue";
import { APPLY_COPY } from "./strings";

/**
 * The filed card's road-test certificate (RT4, §391.31(g)).
 *
 * Three things are pinned: the button is offered only when the link says there is a certificate; it
 * asks the certificate's own route — never `/document`, which is the application — and opens what
 * comes back; and a refusal (or a blocked popup) says so and names the other way to get it.
 */

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", fetchMock);
const openMock = vi.fn();
vi.stubGlobal("open", openMock);

const TOKEN = "t".repeat(43);
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

const mountCard = (roadTestCertificate: { testedOn: string } | null) =>
  mount(ApplicationFiledCard, { props: { token: TOKEN, carrier: "Silvicom Inc", roadTestCertificate, packetPlaces: 14 } });

const certificateButton = (w: ReturnType<typeof mountCard>) =>
  w.findAll("button").find((b) => b.text() === APPLY_COPY.done.certificate);

beforeEach(() => {
  fetchMock.mockReset();
  openMock.mockReset();
});

describe("the driver's road-test certificate on the filed card", () => {
  it("offers no certificate button when the link has none", () => {
    const w = mountCard(null);
    expect(certificateButton(w)).toBeUndefined();
    // The application's own copy is still there — the certificate is beside it, not instead of it.
    expect(w.text()).toContain(APPLY_COPY.done.download);
  });

  it("offers it with the test date, written the product's one way", () => {
    const w = mountCard({ testedOn: "2026-09-25" });
    expect(certificateButton(w)).toBeDefined();
    expect(w.text()).toContain("From your road test on 09/25/2026.");
  });

  it("asks the certificate's route, not the application's, and opens the URL it gets", async () => {
    fetchMock.mockResolvedValue(ok({
      ok: true, url: "https://storage.test/cert.pdf", filename: "road-test-certificate.pdf", expiresInSeconds: 300,
    }));
    openMock.mockReturnValue({});
    const w = mountCard({ testedOn: "2026-09-25" });

    await certificateButton(w)!.trigger("click");
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/public/application/${TOKEN}/road-test-certificate`);
    expect(openMock).toHaveBeenCalledWith("https://storage.test/cert.pdf", "_blank", "noopener");
    expect(w.text()).not.toContain(APPLY_COPY.done.certificateFailed);
  });

  it("says so when the popup is blocked, and leaves the application's copy alone", async () => {
    fetchMock.mockResolvedValue(ok({ ok: true, url: "https://storage.test/cert.pdf" }));
    openMock.mockReturnValue(null);
    const w = mountCard({ testedOn: "2026-09-25" });

    await certificateButton(w)!.trigger("click");
    await flushPromises();

    expect(w.text()).toContain(APPLY_COPY.done.certificateFailed);
    // Two flags, not one: the certificate failing must not tell the driver their application failed.
    expect(w.text()).not.toContain(APPLY_COPY.done.downloadFailed);
  });

  it("says so when the server refuses", async () => {
    fetchMock.mockResolvedValue({
      ok: false, status: 409,
      json: async () => ({ ok: false, error: { code: "no_certificate", message: "not yet" } }),
    });
    const w = mountCard({ testedOn: "2026-09-25" });

    await certificateButton(w)!.trigger("click");
    await flushPromises();

    expect(openMock).not.toHaveBeenCalled();
    expect(w.text()).toContain(APPLY_COPY.done.certificateFailed);
  });
});

/** D-AW16, C3s4b: the envelope carries on into the handbook, so its walk leads the card while places are left. */
describe("the handbook on the filed card", () => {
  const handbook = (over: Record<string, unknown> = {}) => ({
    canOpen: true, openedAt: "2026-09-29T09:00:00Z", driverSigned: [], driverComplete: false, filedAt: null,
    version: "handbook-test-v1", ...over,
  });
  const mountWith = (h: ReturnType<typeof handbook> | null) =>
    mount(ApplicationFiledCard, {
      props: { token: TOKEN, carrier: "Silvicom Inc", roadTestCertificate: null, handbook: h, packetPlaces: 14 },
      global: { stubs: { HandbookSigning: { props: ["packetPlaces"], template: "<div data-handbook :data-packet='packetPlaces' />" } } },
    });

  it("leads with the handbook's walk, carrying the packet's count, while places are left", () => {
    const w = mountWith(handbook({ driverSigned: ["h1"] }));
    expect(w.text()).toContain(APPLY_COPY.handbook.filedThen);
    expect(w.text()).not.toContain(APPLY_COPY.done.heading);
    expect(w.find("[data-handbook]").attributes("data-packet")).toBe("14");
  });

  it("is the filed page again once the driver has signed every place, with the handbook at its foot", () => {
    const w = mountWith(handbook({ driverComplete: true }));
    expect(w.text()).toContain(APPLY_COPY.done.heading);
    expect(w.text()).not.toContain(APPLY_COPY.handbook.filedThen);
    expect(w.find("[data-handbook]").exists()).toBe(true);
  });

  it("says nothing about a handbook that is not open", () => {
    const w = mountWith(handbook({ openedAt: null }));
    expect(w.text()).toContain(APPLY_COPY.done.heading);
    expect(w.find("[data-handbook]").exists()).toBe(false);
  });
});
