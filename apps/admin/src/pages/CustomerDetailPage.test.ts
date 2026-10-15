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
