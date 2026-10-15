import { afterEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount } from "@vue/test-utils";
import MfaPage from "./MfaPage.vue";
import { mountPage, settle } from "@/testing/mountPage";

const mfa = vi.hoisted(() => ({
  getAuthenticatorAssuranceLevel: vi.fn(async () => ({ data: { currentLevel: "aal1" } })),
  listFactors: vi.fn(),
  enroll: vi.fn(),
  challengeAndVerify: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { mfa } }, ADMIN_API_URL: "" }));

enableAutoUnmount(afterEach);

describe("two-factor sign-in (US7)", () => {
  it("says setting it up failed and offers Retry, instead of a code form with nothing behind it", async () => {
    mfa.listFactors.mockResolvedValueOnce({ data: null, error: new Error("network") });
    const { wrapper } = await mountPage(MfaPage, "/");
    expect(wrapper.text()).toContain("Could not start two-factor sign-in.");
    expect(wrapper.find('input[autocomplete="one-time-code"]').exists()).toBe(false);

    mfa.listFactors.mockResolvedValueOnce({ data: { totp: [{ id: "f1", status: "verified" }] }, error: null });
    await wrapper.findAll("button").find((b) => b.text().includes("Retry"))!.trigger("click");
    await settle();
    expect(wrapper.find('input[autocomplete="one-time-code"]').exists()).toBe(true);
  });
});
