import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import SmsOptInCard from "@/features/apply/SmsOptInCard.vue";
import { APPLY_COPY } from "@/features/apply/strings";
import { SMS_PRIVACY_PATH, SMS_TERMS_PATH } from "@/lib/legalPaths";

/**
 * The optional text-message card (SMS-OPT-IN-PLAN SMS2).
 *
 * What a carrier reviewer checks in the screenshot, pinned here so a later edit cannot quietly break
 * it: the box starts unticked, the full served consent is beside it, both links are present, nothing
 * is sent until the box is ticked and the number parses, and the card is absent while the wording is
 * draft. Plus the way out: an agreed card offers "Turn off texts".
 */

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", fetchMock);

const TOKEN = "t".repeat(43);
const DOC = {
  version: "v1", title: "Text message consent", citation: "47 U.S.C. §227",
  body: "By checking this box, you agree that Silvicom Inc may send text messages. Reply STOP to stop.",
  intent: "I agree to receive text messages from Silvicom Inc about my application.",
};
const status = (over: Record<string, unknown> = {}) => ({
  offered: true, state: "none", phoneLast4: null, grantedAt: null, revokedAt: null, ...over,
});
const ok = (body: unknown) => ({ ok: true, json: async () => body });

const mountCard = async (first: unknown) => {
  fetchMock.mockReset().mockResolvedValueOnce(ok(first));
  const w = mount(SmsOptInCard, { props: { token: TOKEN, carrier: "Silvicom Inc" }, global: { plugins: [VueQueryPlugin] } });
  await flushPromises();
  return w;
};
const action = (w: Awaited<ReturnType<typeof mountCard>>, label: string) =>
  w.findAll("button").find((b) => b.text() === label)!;

beforeEach(() => fetchMock.mockReset());

describe("the offer", () => {
  it("is absent while the wording is draft", async () => {
    const w = await mountCard({ document: DOC, status: status({ offered: false }) });
    expect(w.find("section").exists()).toBe(false);
  });

  it("says it is optional, shows the served consent in full, and links both documents", async () => {
    const w = await mountCard({ document: DOC, status: status() });
    expect(w.text()).toContain(APPLY_COPY.sms.optional);
    expect(w.text()).toContain(DOC.body);
    expect(w.text()).toContain(DOC.intent);
    const hrefs = w.findAll("a").map((a) => a.attributes("href"));
    expect(hrefs).toEqual(expect.arrayContaining([SMS_TERMS_PATH, SMS_PRIVACY_PATH]));
  });

  it("starts unticked and cannot be sent until ticked with a valid number", async () => {
    const w = await mountCard({ document: DOC, status: status() });
    const box = w.find('input[type="checkbox"]');
    expect((box.element as HTMLInputElement).checked).toBe(false);
    expect(action(w, APPLY_COPY.sms.action).attributes("disabled")).toBeDefined();

    await w.find('input[type="tel"]').setValue("(708) 236-5732");
    expect(action(w, APPLY_COPY.sms.action).attributes("disabled")).toBeDefined();
    await box.setValue(true);
    expect(action(w, APPLY_COPY.sms.action).attributes("disabled")).toBeUndefined();
  });

  it("sends the act and the number, never the words", async () => {
    const w = await mountCard({ document: DOC, status: status() });
    fetchMock.mockResolvedValueOnce(ok({ status: status({ state: "agreed", phoneLast4: "5732" }), confirmation: "sent" }));
    await w.find('input[type="tel"]').setValue("708 236 5732");
    await w.find('input[type="checkbox"]').setValue(true);
    await action(w, APPLY_COPY.sms.action).trigger("click");
    await flushPromises();

    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe(`/api/public/application/${TOKEN}/sms-consent`);
    expect(JSON.parse(init.body)).toEqual({ phone: "708 236 5732", agreed: true });
    expect(w.text()).toContain(APPLY_COPY.sms.onBody("5732"));
    expect(w.text()).toContain(APPLY_COPY.sms.confirmationSent);
  });

  it("flags a number that is not a US mobile, once the field is left", async () => {
    const w = await mountCard({ document: DOC, status: status() });
    const input = w.find('input[type="tel"]');
    await input.setValue("12345");
    await input.trigger("blur");
    expect(w.text()).toContain(APPLY_COPY.sms.phoneInvalid);
  });
});

describe("the way out", () => {
  it("offers to turn texts off once they are on, and says so after", async () => {
    const w = await mountCard({ document: DOC, status: status({ state: "agreed", phoneLast4: "5732" }) });
    expect(w.find('input[type="checkbox"]').exists()).toBe(false);
    fetchMock.mockResolvedValueOnce(ok({ status: status({ state: "stopped", phoneLast4: "5732", revokedAt: "2026-09-25T12:00:00Z" }) }));
    await action(w, APPLY_COPY.sms.stop).trigger("click");
    await flushPromises();

    expect(fetchMock.mock.calls[1]![0]).toBe(`/api/public/application/${TOKEN}/sms-consent/withdraw`);
    expect(w.text()).toContain(APPLY_COPY.sms.offHeading);
    // Stopped is not a dead end: the applicant may turn texts back on themselves.
    expect(w.find('input[type="checkbox"]').exists()).toBe(true);
  });
});
