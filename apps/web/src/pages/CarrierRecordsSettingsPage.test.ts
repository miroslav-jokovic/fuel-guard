import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import type { UserRole } from "@silvicom/shared";
import CarrierRecordsSettingsPage from "./CarrierRecordsSettingsPage.vue";
import RequirementTable from "@/components/files/RequirementTable.vue";

/**
 * Settings › Carrier records as the carrier's file (DQ-INTO-DRIVERS-PLAN DD5, D-DQ23): which rows the
 * carrier is asked for, which of them each reader may record, where the scan comes from, and the
 * reminder that the fleet's insurance and IFTA hold every truck at "missing" until filed (DD3).
 */
type Cert = { id: string; kind: string; issued_at: string | null; expires_at: string | null; document_id: string | null };
const certs = ref<Cert[]>([]);
const docs = ref<Array<{ id: string; kind: string; url: string | null; thumbUrl: string | null; contentType: string }>>([]);
const modules = ref<Set<string>>(new Set(["hazmatguard"]));
const q = (data: unknown) => ({ data, isLoading: ref(false), isError: ref(false), isFetching: ref(false), refetch: vi.fn() });
vi.mock("@/composables/useCompliance", () => ({
  useCertificationsQuery: () => q(certs),
  useDocumentsQuery: () => q(docs),
}));
vi.mock("@/composables/useModules", () => ({ useModulesQuery: () => q(modules) }));
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = Object.assign(fakeSession("safety_manager"), { orgId: "org-1" });
  return { useSessionStore: () => s, __session: s };
});
vi.mock("@/components/ui/PageHeader.vue", () => ({ default: { template: "<header />" } }));
// The children that read their own queries are stubbed; the table renders for real.
const { stub } = vi.hoisted(() => ({
  stub: (name: string, props: string[] = []) => ({ default: { name, props, template: `<div data-stub="${name}" />` } }),
}));
vi.mock("@/components/files/DocumentDropCard.vue", () => stub("DocumentDropCard", ["subject", "items"]));
vi.mock("@/components/files/CertificationHistory.vue", () => stub("CertificationHistory", ["subject"]));
vi.mock("@/components/files/RequirementDrawer.vue", () => stub("RequirementDrawer", ["open", "subject", "specs", "itemKey", "presetDocument"]));
vi.mock("@/components/DocumentPreview.vue", () => stub("DocumentPreview", ["open", "label", "doc"]));

const asRole = async (role: UserRole) => {
  const { __session } = (await import("@/stores/session")) as unknown as { __session: { role: UserRole } };
  __session.role = role;
};
const mountPage = async () => {
  const w = mount(CarrierRecordsSettingsPage);
  await flushPromises();
  return w;
};
type Row = { key: string; state: string; documentUrl: string | null };
const rowsOf = (w: Awaited<ReturnType<typeof mountPage>>) => w.findComponent(RequirementTable).props("rows") as Row[];
const mayRecord = (w: Awaited<ReturnType<typeof mountPage>>) =>
  w.findComponent(RequirementTable).props("canManage") as (key: string) => boolean;
const dropKeys = (w: Awaited<ReturnType<typeof mountPage>>) =>
  ((w.findComponent({ name: "DocumentDropCard" }).props("items") ?? []) as { key: string }[]).map((i) => i.key);

beforeEach(async () => {
  certs.value = [];
  docs.value = [];
  modules.value = new Set(["hazmatguard"]);
  await asRole("safety_manager");
});

describe("Carrier records — the rows the carrier is asked for", () => {
  it("opens a hazmat carrier with nothing filed on its five required records, all missing", async () => {
    const rows = rowsOf(await mountPage());
    expect(rows.map((r) => r.key)).toEqual(["operating_authority", "insurance", "financial_responsibility", "ifta", "phmsa_registration"]);
    expect(rows.every((r) => r.state === "missing")).toBe(true);
  });

  it("asks a carrier without HazmatGuard for no hazmat record", async () => {
    modules.value = new Set();
    expect(rowsOf(await mountPage()).map((r) => r.key)).toEqual(["operating_authority", "insurance", "ifta"]);
  });

  it("shows a PHMSA registration with the scan it cites, which the viewer opens", async () => {
    certs.value = [{ id: "c1", kind: "phmsa_registration", issued_at: "2026-07-01", expires_at: "2027-06-30", document_id: "d1" }];
    docs.value = [{ id: "d1", kind: "phmsa_registration", url: "https://signed/d1", thumbUrl: null, contentType: "application/pdf" }];
    const w = await mountPage();
    expect(rowsOf(w).find((r) => r.key === "phmsa_registration")).toMatchObject({ state: "current", documentUrl: "https://signed/d1" });
    await w.find('[aria-label="View scan for PHMSA registration"]').trigger("click");
    expect(w.findComponent({ name: "DocumentPreview" }).props("doc")).toMatchObject({ id: "d1" });
  });
});

describe("Carrier records — what each reader may record", () => {
  it("lets a safety manager record the carrier's own records, not the fleet's insurance or IFTA", async () => {
    const w = await mountPage();
    const may = mayRecord(w);
    expect(may("phmsa_registration")).toBe(true);
    expect(may("operating_authority")).toBe(true);
    // Those two are the equipment section's (D-UF5), which a safety manager may only view.
    expect(may("insurance")).toBe(false);
    expect(may("ifta")).toBe(false);
    expect(w.find('[aria-label="Record Insurance"]').exists()).toBe(false);
    expect(w.find('[aria-label="Record PHMSA registration"]').exists()).toBe(true);
  });

  it("lets a fleet manager record IFTA as well", async () => {
    await asRole("fleet_manager");
    const may = mayRecord(await mountPage());
    expect(may("ifta")).toBe(true);
    expect(may("insurance")).toBe(true);
  });

  it("offers the conditional hazmat records in the drop card, though they have no row until filed", async () => {
    const w = await mountPage();
    expect(dropKeys(w)).toEqual(expect.arrayContaining(["security_plan", "hazmat_safety_permit", "phmsa_registration"]));
    expect(dropKeys(w)).not.toContain("insurance");
    expect(rowsOf(w).some((r) => r.key === "security_plan")).toBe(false);
  });

  it("offers a reader who may file nothing no drop card and no record action", async () => {
    await asRole("auditor");
    const w = await mountPage();
    expect(w.findComponent({ name: "DocumentDropCard" }).exists()).toBe(false);
    expect(w.find('[aria-label^="Record "]').exists()).toBe(false);
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
    certs.value = [{ id: "c1", kind: "insurance", issued_at: null, expires_at: "2027-01-01", document_id: null }];
    expect((await mountPage()).find("[data-testid=fleet-papers-missing]").text()).toContain("IFTA licence is not on file");
    certs.value.push({ id: "c2", kind: "ifta", issued_at: null, expires_at: "2026-12-31", document_id: null });
    expect((await mountPage()).find("[data-testid=fleet-papers-missing]").exists()).toBe(false);
  });
});
