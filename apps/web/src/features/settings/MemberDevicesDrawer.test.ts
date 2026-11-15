import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { MemberSession, OrgMember } from "@silvicom/shared";

/**
 * "Signed-in devices…" on the Users page (INSTALLED-APP-PLAN IA-S3). What an admin relies on: the member's
 * devices and nobody else's are listed; one press signs one out — after the password, because the API asks —
 * and the SAME device is the one signed out once it is given; a member signed in nowhere reads as that; and the
 * drawer says where "everything at once" already lives.
 */
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));
vi.mock("@/components/StepUpPrompt.vue", () => ({
  default: { props: ["reason"], emits: ["confirmed", "cancel"], template: `<div data-testid="step-up">{{ reason }}<button data-testid="confirm" @click="$emit('confirmed')">Confirm</button></div>` },
}));

const BEN = { userId: "22222222-2222-4222-8222-222222222222", email: "ben@example.test", fullName: "Ben Admin" } as OrgMember;
const PHONE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const device = (id: string, name: string, current = false): MemberSession =>
  ({ id, device: name, created_at: "2026-11-01T14:00:00+00:00", last_used_at: "2026-11-15T16:00:00+00:00", ip: "203.0.113.7", current });

let server: MemberSession[];
let needPassword: boolean;
const deletes = () => apiFetch.mock.calls.filter(([, init]) => init?.method === "DELETE").map(([path]) => path as string);

beforeEach(() => {
  server = [device(PHONE, "Safari on iPhone"), device(PC, "Chrome on Windows")];
  needPassword = false;
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (init?.method !== "DELETE") return { ok: true, status: 200, data: { sessions: server } };
    if (needPassword) {
      needPassword = false;
      return { ok: false, status: 403, error: { code: "step_up_required", message: "Confirm your password to continue." } };
    }
    server = server.filter((d) => !path.endsWith(d.id));
    return { ok: true, status: 200, data: { ended: true } };
  });
});

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
});
async function open(member: OrgMember | null = BEN) {
  const { default: MemberDevicesDrawer } = await import("./MemberDevicesDrawer.vue");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const w = mount(MemberDevicesDrawer, { props: { member }, attachTo: document.body, global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } });
  mounted.push(w);
  await flushPromises();
  return w;
}
const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
const rows = () => [...document.body.querySelectorAll('[data-testid="signed-in-devices"] li')];
const click = async (el: Element | null | undefined) => {
  if (!el) throw new Error(`nothing to press in: ${text()}`);
  (el as HTMLElement).click();
  await flushPromises();
};
const signOutButton = (name: string) => [...document.body.querySelectorAll("button")].find((b) => b.getAttribute("aria-label")?.startsWith(`Sign out ${name}`));

describe("a member's signed-in devices", () => {
  it("asks for that member's devices and lists them, under their address", async () => {
    await open();
    expect(apiFetch.mock.calls[0]![0]).toBe(`/api/members/${BEN.userId}/sessions`);
    expect(rows().map((r) => r.querySelector("p")!.textContent!.trim())).toEqual(["Safari on iPhone", "Chrome on Windows"]);
    expect(text()).toContain("ben@example.test");
  });

  it("asks for nothing while no member is chosen", async () => {
    await open(null);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("signs one device out and shows the list as the server now has it", async () => {
    await open();
    await click(signOutButton("Safari on iPhone"));
    expect(deletes()).toEqual([`/api/members/${BEN.userId}/sessions/${PHONE}`]);
    expect(rows()).toHaveLength(1);
    expect(text()).toContain("Safari on iPhone is signed out.");
  });

  it("asks for the password when the API does, then signs out the SAME device", async () => {
    needPassword = true;
    await open();
    await click(signOutButton("Chrome on Windows"));
    expect(document.body.querySelector('[data-testid="step-up"]')!.textContent).toContain("Confirm your password to continue.");
    expect(rows()).toHaveLength(0); // the prompt replaces the list
    await click(document.body.querySelector('[data-testid="confirm"]'));
    expect(deletes()).toEqual([`/api/members/${BEN.userId}/sessions/${PC}`, `/api/members/${BEN.userId}/sessions/${PC}`]);
    expect(rows().map((r) => r.querySelector("p")!.textContent!.trim())).toEqual(["Safari on iPhone"]);
  });

  it("gives the admin's own device in use no button", async () => {
    server = [device(PC, "Chrome on Windows", true), device(PHONE, "Safari on iPhone")];
    await open();
    expect(rows()[0]!.textContent).toContain("This device");
    expect(rows()[0]!.querySelector("button")).toBeNull();
  });

  it("says so when the member is signed in nowhere", async () => {
    server = [];
    await open();
    expect(document.body.querySelector('[data-testid="member-devices-empty"]')!.textContent).toBe("Ben Admin is not signed in anywhere.");
  });

  it("treats a device that was already gone as signed out, not as an error", async () => {
    apiFetch.mockImplementation(async (_path: string, init?: { method?: string }) =>
      init?.method === "DELETE" ? { ok: false, status: 404, error: { code: "not_found", message: "That device is no longer signed in" } } : { ok: true, status: 200, data: { sessions: server } });
    await open();
    await click(signOutButton("Safari on iPhone"));
    expect(document.body.querySelector("[role=status]")!.textContent).toBe("Safari on iPhone is signed out.");
  });

  it("says a refusal in words and keeps the list", async () => {
    apiFetch.mockImplementation(async (_path: string, init?: { method?: string }) =>
      init?.method === "DELETE" ? { ok: false, status: 409, error: { code: "current_session", message: "This is the device you are using. Use Sign out to end it." } } : { ok: true, status: 200, data: { sessions: server } });
    await open();
    await click(signOutButton("Safari on iPhone"));
    expect(document.body.querySelector("[role=status]")!.textContent).toBe("This is the device you are using. Use Sign out to end it.");
    expect(rows()).toHaveLength(2);
  });

  it("says where signing out everything already lives", async () => {
    await open();
    expect(text()).toContain("use Suspend member or Send password reset");
  });
});
