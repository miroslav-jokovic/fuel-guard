import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { formatDisplayDateTime, type MemberSession } from "@silvicom/shared";

/**
 * "Signed-in devices" in the account menu (INSTALLED-APP-PLAN IA-S3). What a person relies on: every place
 * they are signed in is listed with what tells them apart; the device in their hand is marked and cannot be
 * signed out from here; one press signs another device out and the list shows what the server then says; all
 * the others can go at once without touching this one; a refusal is said in words; and the panel says what
 * "signed out" does not mean.
 */
const apiFetch = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { signOut } }, DEV_BYPASS: false }));

const THIS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PHONE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OLD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const device = (id: string, name: string, used: string, current = false): MemberSession =>
  ({ id, device: name, created_at: "2026-11-01T14:00:00+00:00", last_used_at: used, ip: current ? "203.0.113.7" : null, current });

let server: MemberSession[];
const deletes = () => apiFetch.mock.calls.filter(([, init]) => init?.method === "DELETE").map(([path]) => path as string);

beforeEach(() => {
  server = [device(PHONE, "Safari on iPhone", "2026-11-15T18:30:00+00:00"), device(THIS, "Chrome on Windows", "2026-11-15T16:00:00+00:00", true), device(OLD, "Firefox on Mac", "2026-03-02T09:00:00+00:00")];
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (init?.method === "DELETE") {
      server = server.filter((d) => !path.endsWith(d.id));
      return { ok: true, status: 200, data: { ended: true } };
    }
    return { ok: true, status: 200, data: { sessions: server } };
  });
  signOut.mockReset();
  signOut.mockImplementation(async () => {
    server = server.filter((d) => d.current);
    return { error: null };
  });
});

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
});
async function openPanel() {
  vi.resetModules(); // the module holds the app's one "is it open"; each test starts closed
  const { useSignedInDevicesPanel } = await import("./useSignedInDevices");
  useSignedInDevicesPanel().show();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mounted.push(mount((await import("./SignedInDevicesPanel.vue")).default, { attachTo: document.body, global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } }));
  await flushPromises();
}
const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
const rows = () => [...document.body.querySelectorAll('[data-testid="signed-in-devices"] li')];
const press = async (label: string) => {
  const b = [...document.body.querySelectorAll("button")].find((x) => x.textContent?.trim() === label || x.getAttribute("aria-label")?.startsWith(label));
  if (!b) throw new Error(`no button "${label}" in: ${text()}`);
  b.click();
  await flushPromises();
};

describe("Signed-in devices", () => {
  it("lists every sign-in with what tells them apart, in the house date and time", async () => {
    await openPanel();
    expect(apiFetch.mock.calls[0]![0]).toBe("/api/me/sessions");
    expect(rows()).toHaveLength(3);
    expect(rows()[0]!.textContent).toContain("Safari on iPhone");
    expect(rows()[0]!.textContent).toContain(`Last used ${formatDisplayDateTime("2026-11-15T18:30:00+00:00")}`);
    expect(rows()[1]!.textContent).toContain("203.0.113.7");
    expect(text()).not.toMatch(/2026-11-15T/);
  });

  it("marks the device in hand and gives it no button — that is Sign out", async () => {
    await openPanel();
    expect(rows()[1]!.textContent).toContain("This device");
    expect(rows()[1]!.querySelector("button")).toBeNull();
    expect(rows()[0]!.querySelector("button")).not.toBeNull();
  });

  it("signs one device out, says so, and shows the list as the server now has it", async () => {
    await openPanel();
    await press("Sign out Safari on iPhone");
    expect(deletes()).toEqual([`/api/me/sessions/${PHONE}`]);
    expect(rows()).toHaveLength(2);
    expect(text()).toContain("Safari on iPhone is signed out.");
    expect(signOut).not.toHaveBeenCalled();
  });

  it("signs out all the others at once, through the auth server, leaving this one", async () => {
    await openPanel();
    await press("Sign out of all 2 other devices");
    expect(signOut).toHaveBeenCalledWith({ scope: "others" });
    expect(deletes()).toEqual([]);
    expect(rows()).toHaveLength(1);
    expect(text()).toContain("You are signed in on this device only.");
  });

  it("does not offer 'all the others' when there is one other, or none", async () => {
    server = server.slice(0, 2);
    await openPanel();
    expect(text()).not.toContain("Sign out of all");
  });

  it("treats a device that was already gone as signed out, not as an error", async () => {
    apiFetch.mockImplementation(async (_path: string, init?: { method?: string }) =>
      init?.method === "DELETE" ? { ok: false, status: 404, error: { code: "not_found", message: "That device is no longer signed in" } } : { ok: true, status: 200, data: { sessions: server } });
    await openPanel();
    await press("Sign out Safari on iPhone");
    expect(text()).toContain("Safari on iPhone is signed out.");
  });

  it("says a refusal in words", async () => {
    apiFetch.mockImplementation(async (_path: string, init?: { method?: string }) =>
      init?.method === "DELETE" ? { ok: false, status: 500, error: { code: "internal", message: "Something went wrong on our side" } } : { ok: true, status: 200, data: { sessions: server } });
    await openPanel();
    await press("Sign out Safari on iPhone");
    expect(document.body.querySelector("[role=status]")!.textContent).toBe("Something went wrong on our side");
    expect(rows()).toHaveLength(3);
  });

  it("says what signed out does not mean: an open device keeps working for up to an hour", async () => {
    await openPanel();
    expect(text()).toContain("it can keep working for up to an hour");
  });

  it("says it could not load rather than showing an empty list", async () => {
    apiFetch.mockImplementation(async () => ({ ok: false, status: 500, error: { code: "internal", message: "down" } }));
    await openPanel();
    expect(text()).toContain("Could not load your devices.");
    expect(rows()).toHaveLength(0);
  });
});
