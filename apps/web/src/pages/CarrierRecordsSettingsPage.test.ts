import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import { AppCombobox } from "@silvicom/ui";
import type { UserRole } from "@silvicom/shared";
import CarrierRecordsSettingsPage from "./CarrierRecordsSettingsPage.vue";

/**
 * Settings › Carrier records (DQ-INTO-DRIVERS-PLAN DD3): which record types each reader is offered,
 * and the reminder that the fleet's insurance and IFTA hold every truck at "missing" until filed.
 */
const certs = ref<Array<{ id: string; kind: string; expires_at: string | null }>>([]);
vi.mock("@/composables/useCompliance", () => ({
  useCertificationsQuery: () => ({ data: certs, isLoading: ref(false), isError: ref(false), isFetching: ref(false), refetch: vi.fn() }),
  useCreateCertification: () => ({ isPending: ref(false), mutateAsync: vi.fn() }),
}));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = Object.assign(fakeSession("safety_manager"), { orgId: "org-1" });
  return { useSessionStore: () => s, __session: s };
});
vi.mock("@/components/ui/PageHeader.vue", () => ({ default: { template: "<header />" } }));

const asRole = async (role: UserRole) => {
  const { __session } = (await import("@/stores/session")) as unknown as { __session: { role: UserRole } };
  __session.role = role;
};
const mountPage = async () => {
  const w = mount(CarrierRecordsSettingsPage);
  await flushPromises();
  return w;
};
const offered = (w: Awaited<ReturnType<typeof mountPage>>) =>
  w.findComponent(AppCombobox).exists()
    ? (w.findComponent(AppCombobox).props("options") as { value: string; label: string }[]).map((o) => o.value)
    : [];

beforeEach(async () => {
  certs.value = [];
  await asRole("safety_manager");
});

describe("Carrier records — what each reader may file", () => {
  it("offers a safety manager the carrier's own records, not the fleet's insurance or IFTA", async () => {
    const kinds = offered(await mountPage());
    expect(kinds).toEqual(expect.arrayContaining(["phmsa_registration", "operating_authority", "security_plan"]));
    // Those two are the equipment section's (D-UF5), which a safety manager may only view.
    expect(kinds).not.toContain("insurance");
    expect(kinds).not.toContain("ifta");
  });

  it("offers a fleet manager IFTA as well, which no screen could file before DD3", async () => {
    await asRole("fleet_manager");
    const kinds = offered(await mountPage());
    expect(kinds).toEqual(expect.arrayContaining(["insurance", "ifta", "phmsa_registration"]));
  });

  it("offers no form to a reader who may file nothing", async () => {
    await asRole("auditor");
    const w = await mountPage();
    expect(w.text()).not.toContain("Add record");
    expect(w.text()).toContain("Current records");
  });

  it("names each record type by the catalogue's words", async () => {
    await asRole("fleet_manager");
    const labels = (await mountPage()).findComponent(AppCombobox).props("options") as { value: string; label: string }[];
    expect(labels.find((o) => o.value === "ifta")?.label).toBe("IFTA licence");
    expect(labels.find((o) => o.value === "phmsa_registration")?.label).toBe("PHMSA registration");
  });
});

describe("Carrier records — the fleet papers every truck counts", () => {
  it("says insurance and IFTA are missing and what that does to the trucks", async () => {
    const callout = (await mountPage()).find("[data-testid=fleet-papers-missing]");
    expect(callout.text()).toContain("Insurance and IFTA licence are not on file");
    expect(callout.text()).toContain("Every truck's file counts them as missing");
  });

  it("tells a reader who cannot file them what it takes, and a fleet manager nothing extra", async () => {
    expect((await mountPage()).text()).toContain("needs permission to manage vehicles");
    await asRole("fleet_manager");
    expect((await mountPage()).text()).not.toContain("needs permission to manage vehicles");
  });

  it("names only what is still missing, and goes once both are on file", async () => {
    certs.value = [{ id: "c1", kind: "insurance", expires_at: "2027-01-01" }];
    expect((await mountPage()).find("[data-testid=fleet-papers-missing]").text()).toContain("IFTA licence is not on file");
    certs.value.push({ id: "c2", kind: "ifta", expires_at: "2026-12-31" });
    expect((await mountPage()).find("[data-testid=fleet-papers-missing]").exists()).toBe(false);
  });
});
