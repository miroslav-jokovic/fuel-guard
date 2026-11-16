import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import TooManyDevicesPage from "./TooManyDevicesPage.vue";

/**
 * The page a fourth device is sent to (IA-S6, Q-IA14 (b)) — the paths the browser spec does not walk: a sign-out
 * the API refuses is said in words and leaves the list; a device signed out elsewhere meanwhile is what was
 * wanted; a place already free says so and still offers Continue; this device is never offered for sign-out
 * in the list (that is the link below it).
 */
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { signOut: vi.fn() } }, DEV_BYPASS: false }));
const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

const dev = (n: number, over: Record<string, unknown> = {}) => ({
  id: `d0d0d0d0-0000-4000-8000-00000000000${n}`, device: `Device ${n}`, current: false, signed_in: true,
  session_id: `bbbbbbbb-bbbb-4bbb-8bbb-00000000000${n}`, first_seen_at: "2026-11-10T09:00:00Z", last_seen_at: "2026-11-16T12:00:00Z",
  addresses: [], ...over,
});
let wrapper: VueWrapper | null = null;
afterEach(() => { wrapper?.unmount(); wrapper = null; apiFetch.mockReset(); });

async function render(devices: unknown[], del: { ok: boolean; status: number; error?: { message: string } } = { ok: true, status: 200 }) {
  setActivePinia(createPinia());
  apiFetch.mockImplementation(async (_path: string, init?: { method?: string }) =>
    init?.method === "DELETE" ? del : { ok: true, status: 200, data: { devices, limit: 3, history_days: 365 } });
  wrapper = mount(TooManyDevicesPage, { global: { plugins: [createPinia()] } });
  await flushPromises();
  return wrapper;
}
const names = (w: VueWrapper) => w.find('[data-testid="too-many-devices-list"]').exists()
  ? w.findAll('[data-testid="too-many-devices-list"] li').map((li) => li.find("p").text()) : [];

describe("TooManyDevicesPage", () => {
  it("lists the devices holding the places — never this one, never one already signed out", async () => {
    const w = await render([dev(1), dev(2, { signed_in: false, session_id: null }), dev(3, { current: true }), dev(4)]);
    expect(names(w)).toEqual(["Device 1", "Device 4"]);
  });

  it("says a refused sign-out in words", async () => {
    const w = await render([dev(1), dev(2), dev(3)], { ok: false, status: 500, error: { message: "Could not sign that device out." } });
    await w.findAll("button").find((b) => b.text() === "Sign out")!.trigger("click");
    await flushPromises();
    expect(w.find('[role="alert"]').text()).toContain("Could not sign that device out.");
  });

  it("takes a device already signed out elsewhere as done", async () => {
    const w = await render([dev(1), dev(2), dev(3)], { ok: false, status: 404 });
    await w.findAll("button").find((b) => b.text() === "Sign out")!.trigger("click");
    await flushPromises();
    expect(w.find('[role="status"]').text()).toContain("is signed out");
    expect(w.find('[role="alert"]').exists()).toBe(false);
  });

  it("says when a place is already free, and still offers Continue", async () => {
    const w = await render([dev(1), dev(2)].map((d) => ({ ...d, signed_in: false, session_id: null })));
    expect(w.find('[data-testid="too-many-devices-free"]').exists()).toBe(true);
    expect(w.findAll("button").some((b) => b.text() === "Continue")).toBe(true);
  });
});
