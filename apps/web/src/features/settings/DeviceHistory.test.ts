import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { formatDisplayDateTime, type MemberDevicesResponse } from "@silvicom/shared";
import DeviceHistory from "./DeviceHistory.vue";

/**
 * Device history (INSTALLED-APP-PLAN IA-S6, Q-IA17/Q-IA18 (a)). What a person — or an admin, about a member —
 * relies on: every device the account was used on, kept past sign-out and said to be signed out; which one is in
 * their hand; every address each used, with when; how long it is kept, in the API's own number; and nothing asked
 * while there is nobody to ask about.
 */
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));

const ANSWER: MemberDevicesResponse = {
  limit: 3,
  history_days: 365,
  devices: [
    {
      id: "d0d0d0d0-0000-4000-8000-000000000001", device: "Chrome on Windows", current: true, signed_in: true,
      session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", first_seen_at: "2026-11-16T14:00:00Z", last_seen_at: "2026-11-16T15:00:00Z",
      addresses: [{ ip: "203.0.113.7", first_seen_at: "2026-11-16T14:00:00Z", last_seen_at: "2026-11-16T15:00:00Z" }],
    },
    {
      id: "d0d0d0d0-0000-4000-8000-000000000002", device: "Safari on iPhone", current: false, signed_in: true,
      session_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", first_seen_at: "2026-11-10T09:00:00Z", last_seen_at: "2026-11-16T12:00:00Z",
      addresses: [],
    },
    {
      id: "d0d0d0d0-0000-4000-8000-000000000003", device: "Firefox on Linux", current: false, signed_in: false, session_id: null,
      first_seen_at: "2026-11-02T09:00:00Z", last_seen_at: "2026-11-09T18:00:00Z",
      addresses: [
        { ip: "198.51.100.24", first_seen_at: "2026-11-05T09:00:00Z", last_seen_at: "2026-11-09T18:00:00Z" },
        { ip: "192.0.2.10", first_seen_at: "2026-11-02T09:00:00Z", last_seen_at: "2026-11-04T09:00:00Z" },
      ],
    },
  ],
};

let wrapper: VueWrapper | null = null;
afterEach(() => { wrapper?.unmount(); wrapper = null; apiFetch.mockReset(); });

async function render(path: string | null, answer: unknown = ANSWER, ok = true) {
  apiFetch.mockResolvedValue(ok ? { ok: true, status: 200, data: answer } : { ok: false, status: 500, error: { message: "boom" } });
  wrapper = mount(DeviceHistory, {
    props: { path },
    global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]] },
  });
  await flushPromises();
  return wrapper;
}
const rows = (w: VueWrapper) => w.findAll('[data-testid="device-history-row"]').map((r) => r.text());

describe("DeviceHistory", () => {
  it("asks the path it is given", async () => {
    await render("/api/members/22222222-2222-4222-8222-222222222222/devices");
    expect(apiFetch).toHaveBeenCalledWith("/api/members/22222222-2222-4222-8222-222222222222/devices");
  });

  it("asks nothing while there is nobody to ask about", async () => {
    await render(null);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("marks the device in hand, the others signed in, and a signed-out one as signed out — still listed", async () => {
    const r = rows(await render("/api/me/devices"));
    expect(r[0]).toContain("Chrome on Windows");
    expect(r[0]).toContain("This device");
    expect(r[1]).toContain("Signed in");
    expect(r[2]).toContain("Firefox on Linux");
    expect(r[2]).toContain("Signed out");
  });

  it("shows every address a device used, with when", async () => {
    const r = rows(await render("/api/me/devices"))[2]!;
    expect(r).toContain("198.51.100.24");
    expect(r).toContain("192.0.2.10");
    expect(r).toContain(formatDisplayDateTime("2026-11-02T09:00:00Z"));
  });

  it("says how long it is kept from the API's own number, not a copy of it", async () => {
    expect((await render("/api/me/devices")).text()).toContain("Kept for 12 months");
    wrapper!.unmount();
    expect((await render("/api/me/devices", { ...ANSWER, history_days: 183 })).text()).toContain("Kept for 6 months");
  });

  it("says when nothing is recorded yet, rather than showing an empty list", async () => {
    const w = await render("/api/me/devices", { ...ANSWER, devices: [] });
    expect(w.find('[data-testid="device-history-empty"]').exists()).toBe(true);
  });

  it("says a failure in words", async () => {
    expect((await render("/api/me/devices", null, false)).text()).toContain("Could not load the device history.");
  });
});
