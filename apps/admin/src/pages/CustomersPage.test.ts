import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { enableAutoUnmount } from "@vue/test-utils";
import CustomersPage from "./CustomersPage.vue";
import { mountPage, settle } from "@/testing/mountPage";
import type { OrgOverview } from "@/lib/api";

vi.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } }, ADMIN_API_URL: "" }));
const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiRecord: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), ...api }));

// `DataTable` draws cards below 768px and jsdom has no `matchMedia`: the desktop table is stubbed in,
// as the web app's list tests do, so there are headers to sort by.
vi.mock("@vueuse/core", async (original) => ({ ...(await original<typeof import("@vueuse/core")>()), useMediaQuery: () => ref(true) }));

enableAutoUnmount(afterEach);

let n = 0;
const org = (name: string, over: Partial<OrgOverview> = {}): OrgOverview => ({
  orgId: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  name,
  createdAt: "2026-01-01T00:00:00Z",
  memberCount: 3,
  vehicleCount: 10,
  activeVehicleCount: 8,
  driverCount: 9,
  openAnomalyCount: 0,
  lastTxnAt: null,
  ...over,
});

beforeEach(() => {
  api.apiGet.mockReset();
});

describe("the Customers list (US7, D-US11)", () => {
  it("lists every customer with a link to each, and reads its search from the URL", async () => {
    api.apiGet.mockResolvedValue({ orgs: [org("Acme Freight", { orgId: "00000000-0000-4000-8000-000000000001" }), org("Blue Line")] });
    const { wrapper } = await mountPage(CustomersPage, "/customers?search=acme");
    expect(wrapper.text()).toContain("Acme Freight");
    expect(wrapper.text()).not.toContain("Blue Line");
    expect(wrapper.find('a[href="/customers/00000000-0000-4000-8000-000000000001"]').exists()).toBe(true);
    expect((wrapper.find('input[type="search"], input').element as HTMLInputElement).value).toBe("acme");
  });

  it("writes the sort to the URL", async () => {
    api.apiGet.mockResolvedValue({ orgs: [org("Acme Freight"), org("Blue Line", { openAnomalyCount: 4 })] });
    const { wrapper, router } = await mountPage(CustomersPage, "/customers");
    await wrapper.findAll("th button").find((b) => b.text().includes("Open alerts"))!.trigger("click");
    await settle();
    expect(router.currentRoute.value.query.sort).toBe("openAnomalyCount");
  });

  it("says the read failed, not that there are no customers", async () => {
    api.apiGet.mockRejectedValue(new Error("Request failed (502)"));
    const { wrapper } = await mountPage(CustomersPage, "/customers");
    expect(wrapper.text()).toContain("Could not load the customers.");
    expect(wrapper.text()).not.toContain("No organizations yet.");
    expect(wrapper.text()).not.toContain("502");
  });
});
