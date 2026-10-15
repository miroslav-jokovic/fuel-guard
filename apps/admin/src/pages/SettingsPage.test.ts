import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { enableAutoUnmount } from "@vue/test-utils";
import { answerConfirm } from "@silvicom/ui/testing";
import SettingsPage from "./SettingsPage.vue";
import { mountPage, settle } from "@/testing/mountPage";

vi.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } }, ADMIN_API_URL: "" }));
const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiRecord: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), ...api }));
// The release card is its own read, and not what these tests are about.
vi.mock("@/components/ReleaseApprovalCard.vue", () => ({ default: { render: () => null } }));
vi.mock("@vueuse/core", async (original) => ({ ...(await original<typeof import("@vueuse/core")>()), useMediaQuery: () => ref(true) }));

enableAutoUnmount(afterEach);

const phone = { id: "r1", channel: "sms", address: "•••• 8639", label: "Miki", createdAt: "2026-10-01T00:00:00Z" };

beforeEach(() => {
  api.apiGet.mockReset();
  api.apiPost.mockReset();
});

describe("platform settings: alert recipients (US7, D-US11)", () => {
  it("says the list could not be read, never that nobody is on it", async () => {
    api.apiGet.mockRejectedValue(new Error("Request failed (500)"));
    const { wrapper } = await mountPage(SettingsPage, "/settings");
    expect(wrapper.text()).toContain("Could not load the alert recipients.");
    expect(wrapper.text()).not.toContain("No one on the list");
  });

  it("asks in the product's dialog before removing the last phone, and says what that costs", async () => {
    api.apiGet.mockResolvedValue({ recipients: [phone] });
    const { wrapper, pinia } = await mountPage(SettingsPage, "/settings");
    const asked = answerConfirm(false, pinia);
    await wrapper.findAll("button").find((b) => b.text().trim() === "Remove")!.trigger("click");
    await settle();
    expect(asked.mock.calls[0]![0]).toMatchObject({ title: "Remove •••• 8639?", confirmLabel: "Remove", tone: "danger" });
    expect(asked.mock.calls[0]![0].message).toContain("last phone");
    expect(api.apiPost).not.toHaveBeenCalled();
  });
});
