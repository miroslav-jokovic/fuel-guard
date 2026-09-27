import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { encode, toSvgPath } from "@silvicom/qr";
import PartOneHandoff from "./PartOneHandoff.vue";
import SmsOptInCard from "@/features/apply/SmsOptInCard.vue";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * The desktop handoff (§6.6.6, C3b2b2). Pinned: the code is THIS link; "Text me the link" is offered
 * only on a live consent and otherwise the optional opt-in card is; the text carries no link or number
 * from the page; and every way the server held it ends at the QR code in words.
 */
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const TOKEN = "t".repeat(43);
const copy = APPLY_COPY.partOne.photo.handoff;
const res = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

const consent = (state: "none" | "agreed" | "stopped", offered = true) => ({
  document: { version: "v1", body: "You agree to texts.", intent: "I agree." },
  status: { offered, state, phoneLast4: state === "none" ? null : "5732", grantedAt: null, revokedAt: null },
});

/** The consent read, then whatever the text-link POST answers. */
function serve(state: "none" | "agreed" | "stopped", textLink?: { status: number; body: unknown }) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (String(url ?? "").endsWith("/text-link") && init?.method === "POST") return res(textLink!.status, textLink!.body);
    return res(200, consent(state));
  });
}

const mountIt = async () => {
  const w = mount(PartOneHandoff, { props: { token: TOKEN, carrier: "Silvicom Inc" }, global: { plugins: [VueQueryPlugin] } });
  await flushPromises();
  return w;
};
const textButton = (w: Awaited<ReturnType<typeof mountIt>>) => w.findAll("button").find((b) => b.text() === copy.textMe);

beforeEach(() => fetchMock.mockReset());

describe("the QR code", () => {
  it("draws this application's own link, from the route's token", async () => {
    serve("none");
    const w = await mountIt();
    const expected = toSvgPath(encode(`${window.location.origin}/apply/${TOKEN}`), { size: 100 });
    expect(w.find("svg path").attributes("d")).toBe(expected);
    expect(w.find("svg").attributes("aria-label")).toBe(copy.qrLabel);
    // Dark on light in either colour scheme: the tokens are light-dark() pairs, so the element pins its own.
    expect(w.find("svg").classes()).toEqual(expect.arrayContaining(["scheme-light", "bg-surface", "text-ink"]));
    expect(w.find("svg path").attributes("fill")).toBe("currentColor");
  });
});

describe("Text me the link", () => {
  it("is not offered without a live consent — the optional opt-in card is, beside the code", async () => {
    serve("none");
    const w = await mountIt();
    expect(textButton(w)).toBeUndefined();
    expect(w.findComponent(SmsOptInCard).exists()).toBe(true);
  });

  it("is not offered to a number that stopped", async () => {
    serve("stopped");
    const w = await mountIt();
    expect(textButton(w)).toBeUndefined();
  });

  it("on a live consent, asks the server with an empty body and says where it went", async () => {
    serve("agreed", { status: 200, body: { outcome: "sent" } });
    const w = await mountIt();
    expect(w.findComponent(SmsOptInCard).exists()).toBe(false);
    await textButton(w)!.trigger("click");
    await flushPromises();
    const post = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/text-link"))!;
    expect(post[0]).toBe(`/api/public/application/${TOKEN}/text-link`);
    // The page names neither the link nor the number — the server composes both.
    expect(post[1].body).toBe("{}");
    expect(w.text()).toContain(copy.sent("5732"));
  });

  it.each([
    ["quiet_hours", copy.held.quiet_hours],
    ["suppressed", copy.held.suppressed],
    ["no_consent", copy.held.no_consent],
  ] as const)("says why a %s hold sent nothing, and points at the QR code", async (held, words) => {
    serve("agreed", { status: 200, body: { outcome: "held", held } });
    const w = await mountIt();
    await textButton(w)!.trigger("click");
    await flushPromises();
    expect(w.find("[role=alert]").text()).toBe(words);
    expect(words).toContain("QR code");
  });

  it("repeats the limiter's own words when the link was texted too often", async () => {
    const message = "We have already texted this link a few times. Use the QR code, or try again in ten minutes.";
    serve("agreed", { status: 429, body: { error: { code: "too_many_requests", message } } });
    const w = await mountIt();
    await textButton(w)!.trigger("click");
    await flushPromises();
    expect(w.find("[role=alert]").text()).toBe(message);
  });

  it("is a 44 px tap target (§6.8)", async () => {
    serve("agreed");
    const w = await mountIt();
    expect(textButton(w)!.classes()).toContain("h-11");
  });
});
