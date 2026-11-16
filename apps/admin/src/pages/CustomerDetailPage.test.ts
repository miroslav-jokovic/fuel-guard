import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount } from "@vue/test-utils";
import { NotFoundError } from "@silvicom/ui";
import { answerConfirm } from "@silvicom/ui/testing";
import CustomerDetailPage from "./CustomerDetailPage.vue";
import { mountPage, settle } from "@/testing/mountPage";
import { ApiRequestError, type OrgDetail } from "@/lib/api";

vi.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } }, ADMIN_API_URL: "" }));
const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiRecord: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), ...api }));

enableAutoUnmount(afterEach);

const ID = "00000000-0000-4000-8000-0000000000a1";
const detail = (): OrgDetail => ({
  orgId: ID,
  name: "Acme Freight",
  createdAt: "2026-01-01T00:00:00Z",
  memberCount: 3,
  vehicleCount: 10,
  activeVehicleCount: 8,
  driverCount: 9,
  openAnomalyCount: 0,
  lastTxnAt: null,
  allowedDomains: ["acme.test"],
  operatingHours: null,
  modules: [{ provider: "samsara", enabled: true, lastSyncedAt: null }],
  entitlements: [
    { moduleKey: "hazmatguard", enabled: true, granted: true },
    { moduleKey: "training", enabled: false, granted: false },
  ],
});

beforeEach(() => {
  api.apiGet.mockReset();
  api.apiPost.mockReset();
  api.apiRecord.mockReset();
  api.apiRecord.mockResolvedValue({ org: detail() });
  api.apiGet.mockImplementation(async (path: string) => {
    if (path === "/admin/me") return { id: "u", email: "owner@silvicominc.com", role: "platform_owner" };
    if (path.endsWith("/members")) return { members: [] };
    if (path === "/admin/impersonation") return { grants: [] };
    throw new Error(`unexpected ${path}`);
  });
});

const button = (w: { findAll: (s: string) => { text: () => string }[] }, text: string) =>
  w.findAll("button").find((b) => b.text().trim() === text) as unknown as { trigger: (e: string) => Promise<void> } | undefined;

describe("one customer (US7, D-US11)", () => {
  it("says no customer has that id, with no Retry, when the record is missing", async () => {
    api.apiRecord.mockRejectedValue(new NotFoundError());
    const { wrapper } = await mountPage(CustomerDetailPage, `/customers/${ID}`);
    expect(wrapper.text()).toContain("No customer has that id.");
    expect(wrapper.text()).not.toContain("Retry");
    expect(wrapper.find('[data-state="not-found"] a[href="/customers"]').text()).toBe("Back to Customers");
  });

  it("asks before revoking a module, naming what disappears, and sends nothing on No", async () => {
    const { wrapper, pinia } = await mountPage(CustomerDetailPage, `/customers/${ID}`);
    const asked = answerConfirm(false, pinia);
    await button(wrapper, "Revoke")!.trigger("click");
    await settle();
    expect(asked).toHaveBeenCalledTimes(1);
    expect(asked.mock.calls[0]![0]).toMatchObject({ title: "Revoke HazmatGuard?", confirmLabel: "Revoke", tone: "danger" });
    expect(api.apiPost).not.toHaveBeenCalled();
  });

  it("grants without asking: turning a module on takes nothing away", async () => {
    api.apiPost.mockResolvedValue({});
    const { wrapper, pinia } = await mountPage(CustomerDetailPage, `/customers/${ID}`);
    const asked = answerConfirm(true, pinia);
    await button(wrapper, "Grant")!.trigger("click");
    await settle();
    expect(asked).not.toHaveBeenCalled();
    expect(api.apiPost).toHaveBeenCalledWith(`/admin/orgs/${ID}/entitlements/training`, { enabled: true });
  });

  it("keeps a refused switch in its own card, and the rest of the customer on screen", async () => {
    api.apiPost.mockRejectedValue(new ApiRequestError(403, "forbidden", null));
    const { wrapper, pinia } = await mountPage(CustomerDetailPage, `/customers/${ID}`);
    answerConfirm(true, pinia);
    await button(wrapper, "Disable")!.trigger("click");
    await settle();
    expect(wrapper.text()).toContain("Only a platform owner or admin can change this.");
    expect(wrapper.text()).toContain("Entitlements");
    expect(wrapper.text()).toContain("Members");
  });
});

/** INSTALLED-APP-PLAN IA-S1, Q-IA11 (b): the way back in for a customer with no other admin to ask. */
describe("removing a member's two-step sign-in", () => {
  const MEMBERS = [
    { userId: "22222222-2222-4222-8222-222222222222", email: "boss@acme.test", role: "admin", createdAt: "2026-01-01T00:00:00Z" },
    { userId: "33333333-3333-4333-8333-333333333333", email: "aaron@drivers.test", role: "driver", createdAt: "2026-01-02T00:00:00Z" },
  ];
  const REASON = "Phoned from the number on file and confirmed their DOT number.";
  const withMembers = (role = "platform_owner") =>
    api.apiGet.mockImplementation(async (path: string) => {
      if (path === "/admin/me") return { id: "u", email: "owner@silvicominc.com", role };
      if (path.endsWith("/members")) return { members: MEMBERS };
      if (path === "/admin/impersonation") return { grants: [] };
      throw new Error(`unexpected ${path}`);
    });
  const fill = async (wrapper: Awaited<ReturnType<typeof mountPage>>["wrapper"], reason: string) => {
    const card = wrapper.findAll("form").find((f) => f.text().includes("Remove two-step sign-in"))!;
    await card.find("select").setValue(MEMBERS[0]!.userId);
    await card.find("input").setValue(reason);
    return card;
  };

  it("removes it for the member chosen, with the reason, after asking — and says what happened", async () => {
    withMembers();
    api.apiPost.mockResolvedValue({ removed: true, sessionsEnded: true });
    const { wrapper, pinia } = await mountPage(CustomerDetailPage, `/customers/${ID}`);
    const asked = answerConfirm(true, pinia);
    const card = await fill(wrapper, REASON);
    await card.trigger("submit");
    await settle();
    expect(asked.mock.calls[0]![0]).toMatchObject({ title: "Remove two-step sign-in for boss@acme.test?", tone: "danger" });
    expect(api.apiPost).toHaveBeenCalledWith(`/admin/orgs/${ID}/members/${MEMBERS[0]!.userId}/second-factor/remove`, { reason: REASON });
    expect(wrapper.text()).toContain("Removed. boss@acme.test is signed out everywhere");
  });

  it("sends nothing on No, and nothing without a real reason", async () => {
    withMembers();
    const { wrapper, pinia } = await mountPage(CustomerDetailPage, `/customers/${ID}`);
    answerConfirm(false, pinia);
    const card = await fill(wrapper, REASON);
    await card.trigger("submit");
    await settle();
    expect(api.apiPost).not.toHaveBeenCalled();
    const short = await fill(wrapper, "lost it");
    expect(short.find("button[type=submit]").attributes("disabled")).toBeDefined();
  });

  it("offers office members only — a driver-app login has no two-step sign-in", async () => {
    withMembers();
    const { wrapper } = await mountPage(CustomerDetailPage, `/customers/${ID}`);
    const options = wrapper.findAll("form").find((f) => f.text().includes("Remove two-step sign-in"))!.findAll("option").map((o) => o.text());
    expect(options.some((o) => o.includes("boss@acme.test"))).toBe(true);
    expect(options.some((o) => o.includes("aaron@drivers.test"))).toBe(false);
  });

  it("says in words when the member has none, and when the operator's own code is too old", async () => {
    withMembers();
    const { wrapper, pinia } = await mountPage(CustomerDetailPage, `/customers/${ID}`);
    answerConfirm(true, pinia);
    api.apiPost.mockRejectedValueOnce(new ApiRequestError(404, "no_second_factor", null));
    await (await fill(wrapper, REASON)).trigger("submit");
    await settle();
    expect(wrapper.text()).toContain("boss@acme.test has no two-step sign-in set up");
    api.apiPost.mockRejectedValueOnce(new ApiRequestError(403, "step_up_required", null));
    await (await fill(wrapper, REASON)).trigger("submit");
    await settle();
    expect(wrapper.text()).toContain("This needs a fresh authenticator code of your own.");
  });

  it("is not shown to support or read-only staff", async () => {
    withMembers("platform_support");
    const { wrapper } = await mountPage(CustomerDetailPage, `/customers/${ID}`);
    expect(wrapper.text()).not.toContain("Remove a member's two-step sign-in");
  });
});
