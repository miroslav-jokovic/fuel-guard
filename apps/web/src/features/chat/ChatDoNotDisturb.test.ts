import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { ChatDndState } from "@silvicom/shared";

/**
 * Do not disturb in the rail (CHAT-WEB-PUSH-PLAN WP5). What a person relies on: Pause offers an hour, tomorrow
 * morning on their own clock, or every night; while paused the rail says until when with one press to resume;
 * the nightly window is set in their browser's zone and can be changed or removed; a refusal is said in words;
 * and the in-tab alerts' test of "quiet now" stops the moment a pause runs out, without waiting for the server.
 */
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));

import ChatDoNotDisturb from "./ChatDoNotDisturb.vue";
import { useChatDnd } from "./useChatDnd";

const NONE: ChatDndState = { paused_until: null, quiet_start: null, quiet_end: null, timezone: "UTC", quiet_now: false };
let server: ChatDndState;
const puts = () => apiFetch.mock.calls.filter(([, init]) => init?.method === "PUT").map(([path, init]) => ({ path, body: init.body }));

beforeEach(() => {
  server = { ...NONE };
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path: string, init?: { method?: string; body?: Record<string, unknown> }) => {
    if (init?.method === "PUT" && path.endsWith("/pause")) {
      const until = init.body!.until as string | null;
      server = { ...server, paused_until: until, quiet_now: until !== null };
    } else if (init?.method === "PUT" && path.endsWith("/schedule")) {
      server = { ...server, quiet_start: init.body!.start as string | null, quiet_end: init.body!.end as string | null, timezone: init.body!.timezone as string };
    }
    return { ok: true, status: 200, data: server };
  });
});

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
  vi.useRealTimers();
});
async function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const w = mount(ChatDoNotDisturb, { attachTo: document.body, global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } });
  mounted.push(w);
  await flushPromises();
  return w;
}
const press = async (w: VueWrapper, label: string) => {
  const b = w.findAll("button").find((x) => x.text().trim() === label);
  if (!b) throw new Error(`no button "${label}" in: ${w.text()}`);
  await b.trigger("click");
  await flushPromises();
};

describe("Do not disturb", () => {
  it("is off until pressed, and Pause says what it means before anything is set", async () => {
    const w = await render();
    expect(w.text()).toContain("Do not disturb: off");
    await press(w, "Pause");
    expect(w.text()).toContain("Nothing buzzes on any of your devices. Messages wait in Chat.");
    expect(puts()).toEqual([]);
  });

  it("pauses for an hour, then says until when and resumes with one press", async () => {
    const w = await render();
    await press(w, "Pause");
    const before = Date.now();
    await press(w, "For 1 hour");
    const [p] = puts();
    expect(p!.path).toBe("/api/chat/push/quiet/pause");
    const until = Date.parse(p!.body.until as string);
    expect(until - before).toBeGreaterThanOrEqual(3_600_000 - 1000);
    expect(until - before).toBeLessThanOrEqual(3_600_000 + 1000);
    expect(w.text()).toMatch(/Do not disturb until/);
    await press(w, "Resume");
    expect(puts()[1]).toEqual({ path: "/api/chat/push/quiet/pause", body: { until: null } });
    expect(w.text()).toContain("Do not disturb: off");
  });

  it("pauses until the next 8:00 AM on the person's own clock", async () => {
    const w = await render();
    await press(w, "Pause");
    await press(w, "Until 8:00 AM");
    const until = new Date(puts()[0]!.body.until as string);
    expect(until.getTime()).toBeGreaterThan(Date.now());
    expect(until.getTime() - Date.now()).toBeLessThanOrEqual(24 * 3_600_000);
    expect(until.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })).toBe("8:00 AM");
  });

  it("sets every night in the browser's zone, offering 10 PM to 7 AM, and can remove it", async () => {
    const w = await render();
    await press(w, "Pause");
    await press(w, "Every night…");
    await w.find("form").trigger("submit");
    await flushPromises();
    expect(puts()[0]).toEqual({
      path: "/api/chat/push/quiet/schedule",
      body: { start: "22:00", end: "07:00", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    });
    expect(w.text()).toContain("Every night 10:00 PM – 7:00 AM");
    await press(w, "Change");
    await press(w, "Remove");
    expect(puts()[1]!.body).toMatchObject({ start: null, end: null });
    expect(w.text()).not.toContain("Every night 10");
  });

  it("will not save a window that starts where it ends", async () => {
    const w = await render();
    await press(w, "Pause");
    await press(w, "Every night…");
    const [from, to] = w.findAll("input[type=time]");
    await from!.setValue("22:00");
    await to!.setValue("22:00");
    expect(w.text()).toContain("Pick a different end time.");
    expect(w.findAll("button").find((b) => b.text() === "Save")!.attributes("disabled")).toBeDefined();
  });

  it("says a refusal in words", async () => {
    apiFetch.mockImplementation(async (_path: string, init?: { method?: string }) =>
      init?.method === "PUT" ? { ok: false, status: 422, error: { code: "invalid_request", message: "a pause is at most seven days" } } : { ok: true, status: 200, data: NONE });
    const w = await render();
    await press(w, "Pause");
    await press(w, "For 1 hour");
    expect(w.find("[role=status]").text()).toBe("a pause is at most seven days");
  });
});

describe("quiet now, for the in-tab alerts", () => {
  it("holds while the server says so, and stops the moment the pause runs out — without waiting for a refresh", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-13T20:00:00Z"));
    server = { ...NONE, paused_until: "2026-11-13T21:00:00Z", quiet_now: true };
    let dnd!: ReturnType<typeof useChatDnd>;
    const Host = defineComponent({ setup() { dnd = useChatDnd(); return () => h("div"); } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mounted.push(mount(Host, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } }));
    await flushPromises();
    expect(dnd.quietNow()).toBe(true);
    vi.setSystemTime(new Date("2026-11-13T21:00:01Z"));
    expect(dnd.quietNow()).toBe(false);
  });

  it("is not quiet when the server says not", async () => {
    let dnd!: ReturnType<typeof useChatDnd>;
    const Host = defineComponent({ setup() { dnd = useChatDnd(); return () => h("div"); } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mounted.push(mount(Host, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } }));
    await flushPromises();
    expect(dnd.quietNow()).toBe(false);
  });
});
