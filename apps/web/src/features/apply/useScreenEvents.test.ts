import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref, type Component, type PropType } from "vue";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import type { ApplyScreen } from "@silvicom/shared";

const post = vi.hoisted(() => vi.fn());
vi.mock("./useApplication", async (orig) => ({
  ...(await orig<typeof import("./useApplication")>()),
  publicFetch: post,
}));
const { REPORT_EVERY_MS, provideScreenEvents, useApplyScreen } = await import("./useScreenEvents");

/**
 * The screen reports (AW14, C3d3a): which screen is showing, as the deepest one mounted; a visit closed
 * by a change of screen AND by the phone being put away; reported batched — on the minute while
 * something changed, when hidden, when the page closes — and a failed report kept for the next one.
 */
enableAutoUnmount(afterEach);

const Screen: Component = defineComponent({
  props: { name: { type: String as PropType<ApplyScreen | null>, default: null }, inner: { type: String as PropType<ApplyScreen | null>, default: null } },
  setup(props): () => ReturnType<typeof h> | null {
    useApplyScreen(() => props.name);
    return () => (props.inner ? h(Screen, { name: props.inner }) : null);
  },
});

const outer = ref<ApplyScreen | null>("consent");
const inner = ref<ApplyScreen | null>(null);
const shown = ref(true);
const token = ref("tok-1");
const Page = defineComponent({
  setup() {
    provideScreenEvents(token);
    return () => (shown.value ? h(Screen, { name: outer.value, inner: inner.value }) : null);
  },
});

type Sent = { sent_at: string; events: { id: string; screen: string; entered_at: string; left_at: string | null }[] };
const sent = (call = post.mock.calls.length - 1): Sent => JSON.parse(post.mock.calls[call]![1].body as string) as Sent;
const at = (iso: string) => vi.setSystemTime(new Date(iso));
const setVisibility = (state: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  vi.useFakeTimers();
  at("2026-09-28T15:00:00.000Z");
  post.mockReset();
  post.mockResolvedValue({ ok: true });
  [outer.value, inner.value, shown.value, token.value] = ["consent", null, true, "tok-1"];
  setVisibility("visible");
});
afterEach(() => vi.useRealTimers());

describe("which screen", () => {
  it("is the deepest one showing, and falls back to its parent when that one goes", async () => {
    mount(Page);
    inner.value = "part1.about";
    await nextTick();
    at("2026-09-28T15:01:00.000Z");
    inner.value = null;
    await nextTick();
    await vi.advanceTimersByTimeAsync(REPORT_EVERY_MS);
    const events = sent().events;
    expect(events.map((e) => [e.screen, e.left_at])).toEqual([
      ["consent", "2026-09-28T15:00:00.000Z"],
      ["part1.about", "2026-09-28T15:01:00.000Z"],
      ["consent", null],
    ]);
  });

  it("names nothing while no screen is up, and reports nothing", async () => {
    outer.value = null;
    mount(Page);
    await vi.advanceTimersByTimeAsync(REPORT_EVERY_MS * 2);
    expect(post).not.toHaveBeenCalled();
  });
});

describe("the reports", () => {
  it("batches a minute of screens into one request, on the link's own address, sent keepalive", async () => {
    mount(Page);
    await nextTick();
    at("2026-09-28T15:00:20.000Z");
    outer.value = "part1";
    await nextTick();
    expect(post).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(REPORT_EVERY_MS);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]![0]).toBe("/tok-1/screen-events");
    expect(post.mock.calls[0]![1]).toMatchObject({ method: "POST", keepalive: true });
    const body = sent();
    expect(body.sent_at).toBe("2026-09-28T15:01:20.000Z");
    expect(body.events.map((e) => [e.screen, e.entered_at, e.left_at])).toEqual([
      ["consent", "2026-09-28T15:00:00.000Z", "2026-09-28T15:00:20.000Z"],
      ["part1", "2026-09-28T15:00:20.000Z", null],
    ]);
  });

  it("does not resend what the server holds; an open visit is sent again only once it closes, under the same id", async () => {
    mount(Page);
    await nextTick();
    await vi.advanceTimersByTimeAsync(REPORT_EVERY_MS);
    const first = sent().events;
    expect(first).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(REPORT_EVERY_MS);
    expect(post).toHaveBeenCalledTimes(1);
    outer.value = "identity";
    await nextTick();
    await vi.advanceTimersByTimeAsync(REPORT_EVERY_MS);
    const second = sent().events;
    expect(second[0]).toMatchObject({ id: first[0]!.id, screen: "consent" });
    expect(second[0]!.left_at).not.toBeNull();
    expect(second.map((e) => e.screen)).toEqual(["consent", "identity"]);
  });

  it("keeps a visit that closed while its open copy was being reported, and sends it closed next time", async () => {
    let answer!: (v: unknown) => void;
    post.mockImplementationOnce(() => new Promise((r) => (answer = r)));
    mount(Page);
    await nextTick();
    await vi.advanceTimersByTimeAsync(REPORT_EVERY_MS);
    const open = sent().events[0]!;
    expect(open.left_at).toBeNull();
    // The screen changes while that report is still out, then the server answers it.
    outer.value = "identity";
    await nextTick();
    answer({ ok: true });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(REPORT_EVERY_MS);
    const next = sent().events;
    // ⚠ Asserted as a string: a visit that went missing from the report reads `undefined`, which
    // `not.toBeNull()` would have accepted.
    expect(next.find((e) => e.id === open.id)).toMatchObject({ screen: "consent", left_at: expect.any(String) });
  });

  it("keeps a failed report's visits for the next one", async () => {
    post.mockRejectedValueOnce(Object.assign(new Error("offline"), { code: "network" }));
    mount(Page);
    await nextTick();
    await vi.advanceTimersByTimeAsync(REPORT_EVERY_MS);
    const lost = sent().events;
    await vi.advanceTimersByTimeAsync(REPORT_EVERY_MS);
    expect(post).toHaveBeenCalledTimes(2);
    expect(sent().events.map((e) => e.id)).toEqual(lost.map((e) => e.id));
  });

  it("stops reporting on a dead link", async () => {
    post.mockRejectedValue(Object.assign(new Error("dead"), { code: "invalid_link" }));
    mount(Page);
    await nextTick();
    await vi.advanceTimersByTimeAsync(REPORT_EVERY_MS);
    outer.value = "identity";
    await nextTick();
    await vi.advanceTimersByTimeAsync(REPORT_EVERY_MS * 3);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("sends the oldest fifty when more are waiting, and the rest next time", async () => {
    mount(Page);
    await nextTick();
    for (let i = 0; i < 60; i += 1) {
      outer.value = i % 2 ? "consent" : "identity";
      await nextTick();
    }
    await vi.advanceTimersByTimeAsync(REPORT_EVERY_MS);
    const oldest = sent().events;
    expect(oldest).toHaveLength(50);
    expect(oldest[0]!.screen).toBe("consent");
    await vi.advanceTimersByTimeAsync(REPORT_EVERY_MS);
    // 61 visits: the first screen and sixty changes; the last is still open.
    const rest = sent().events;
    expect(rest).toHaveLength(11);
    expect(rest.filter((e) => oldest.some((o) => o.id === e.id))).toEqual([]);
  });
});

describe("time on a screen, not time since the link opened (owner, 2026-09-28)", () => {
  it("closes the visit and reports at once when the phone is put away, and starts a new one when it is back", async () => {
    mount(Page);
    await nextTick();
    at("2026-09-28T15:02:00.000Z");
    setVisibility("hidden");
    await flushPromises();
    expect(post).toHaveBeenCalledTimes(1);
    expect(sent().events.map((e) => [e.screen, e.left_at])).toEqual([["consent", "2026-09-28T15:02:00.000Z"]]);

    // Two days in a pocket are not time on the consent screen.
    at("2026-09-30T09:00:00.000Z");
    setVisibility("visible");
    at("2026-09-30T09:00:40.000Z");
    setVisibility("hidden");
    await flushPromises();
    const back = sent().events;
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ screen: "consent", entered_at: "2026-09-30T09:00:00.000Z", left_at: "2026-09-30T09:00:40.000Z" });
  });

  it("opens no visit for a screen that changes while the phone is away", async () => {
    mount(Page);
    await nextTick();
    setVisibility("hidden");
    await flushPromises();
    outer.value = "identity";
    await nextTick();
    await vi.advanceTimersByTimeAsync(REPORT_EVERY_MS);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("reports when the page closes, and when it is taken down", async () => {
    mount(Page);
    await nextTick();
    window.dispatchEvent(new Event("pagehide"));
    await flushPromises();
    expect(sent().events[0]!.left_at).not.toBeNull();

    post.mockClear();
    const w = mount(Page);
    await nextTick();
    w.unmount();
    await flushPromises();
    expect(post).toHaveBeenCalledTimes(1);
    expect(sent().events[0]!.left_at).not.toBeNull();
  });
});

describe("outside the applicant's page", () => {
  it("a screen mounted alone reports nothing and does not throw", async () => {
    mount(Screen, { props: { name: "consent" } });
    await vi.advanceTimersByTimeAsync(REPORT_EVERY_MS);
    expect(post).not.toHaveBeenCalled();
  });
});
