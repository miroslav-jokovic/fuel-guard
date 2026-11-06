import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import { AppCombobox } from "@silvicom/ui";
import type { PaperIntakeItemDto, UserRole } from "@silvicom/shared";

/**
 * Checking and filing one proposed paper (DRIVER-PAPER-INTAKE-PLAN PI5): the form opens on the reader's
 * proposal, sends the person's answer, offers a restricted paper only to a role that may read it, says
 * where a paper with its own door is filed, and lists what the driver's file still needs.
 */
const fileMut = vi.hoisted(() => ({ mutateAsync: vi.fn(async () => ({ status: "filed" })), isPending: { value: false } }));
const discardMut = vi.hoisted(() => ({ mutateAsync: vi.fn(async () => undefined), isPending: { value: false } }));
vi.mock("./usePaperIntake", async (orig) => ({ ...(await orig<typeof import("./usePaperIntake")>()), useFilePaper: () => fileMut, useDiscardPaper: () => discardMut }));
const A = "3f2b9c1e-8d4a-4b6f-9e21-5c7a0d1e2f34";
vi.mock("@/composables/useDrivers", () => ({ useDriversQuery: () => ({ data: ref([{ id: A, full_name: "Ann Driver" }]) }) }));
vi.mock("@/composables/useCompliance", () => ({
  useComplianceOverviewQuery: () => ({ data: ref({ drivers: [{ driver_id: A, attention: [{ label: "Road test certificate", state: "missing" }, { label: "Medical certificate", state: "expiring" }] }] }) }),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => toast }));
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("safety_manager");
  return { useSessionStore: () => s, __session: s };
});
const SlideOver = { props: ["open", "title"], template: "<div><slot /><slot name='footer' /></div>" };

import PaperReviewDrawer from "./PaperReviewDrawer.vue";

const item = (over: Partial<PaperIntakeItemDto> = {}): PaperIntakeItemDto => ({
  id: "i1", stackId: "s1", partIndex: 0, pages: [5, 7], pieceFrom: 2, pieceTo: 3, driverId: A, driverName: "Ann Driver", basis: "scope",
  kind: "mvr", issuedOn: "2026-01-05", expiresOn: null, title: "Driving Record", unread: false, status: "pending", ...over,
});
const mountDrawer = (i: PaperIntakeItemDto) => mount(PaperReviewDrawer, { props: { open: true, item: i }, global: { stubs: { SlideOver } } });
const fileButton = (w: ReturnType<typeof mountDrawer>) => w.findAll("button").find((b) => b.text() === "File it")!;
const asRole = async (role: UserRole) => {
  ((await import("@/stores/session")) as unknown as { __session: { role: UserRole } }).__session.role = role;
};

beforeEach(async () => {
  fileMut.mutateAsync.mockClear();
  discardMut.mutateAsync.mockClear();
  await asRole("safety_manager");
});

describe("PaperReviewDrawer (PI5)", () => {
  it("files the reader's proposal when the person changes nothing", async () => {
    const w = mountDrawer(item());
    await fileButton(w).trigger("click");
    await flushPromises();
    expect(fileMut.mutateAsync).toHaveBeenCalledWith({ itemId: "i1", body: { driverId: A, kind: "mvr", date: "2026-01-05", expiresOn: null } });
  });

  it("asks a certification for its expiry, and sends it", async () => {
    const w = mountDrawer(item({ kind: "medical_card", issuedOn: "2026-06-01", expiresOn: "2027-06-30" }));
    expect(w.text()).toContain("Expires");
    await fileButton(w).trigger("click");
    await flushPromises();
    expect(fileMut.mutateAsync).toHaveBeenCalledWith({ itemId: "i1", body: { driverId: A, kind: "medical_card", date: "2026-06-01", expiresOn: "2027-06-30" } });
  });

  it("will not file a dated paper with no date, or one with no driver", async () => {
    expect(fileButton(mountDrawer(item({ issuedOn: null }))).attributes("disabled")).toBeDefined();
    expect(fileButton(mountDrawer(item({ driverId: null, driverName: null }))).attributes("disabled")).toBeDefined();
  });

  it("offers a drug test only to a role that may read testing records", async () => {
    const kinds = (w: ReturnType<typeof mountDrawer>) =>
      (w.findAllComponents(AppCombobox).at(1)!.props("options") as Array<{ value: string }>).map((o) => o.value);
    expect(kinds(mountDrawer(item()))).toContain("drug_test");
    await asRole("fleet_manager");
    expect(kinds(mountDrawer(item()))).not.toContain("drug_test");
  });

  it("says where a PSP report is filed instead, and does not propose it", () => {
    const w = mountDrawer(item({ kind: "psp_report" }));
    expect(w.text()).toContain("Employment tab");
    expect(w.findAllComponents(AppCombobox).at(1)!.props("modelValue")).toBe("");
  });

  it("lists what the driver's file still needs, missing and expired only", () => {
    expect(mountDrawer(item()).find("[data-testid=still-needed]").text()).toBe("Still needed in this driver's file: Road test certificate.");
  });

  it("sets a page aside as not a driver-file paper", async () => {
    const w = mountDrawer(item());
    await w.findAll("button").find((b) => b.text() === "Not a driver-file paper")!.trigger("click");
    await flushPromises();
    expect(discardMut.mutateAsync).toHaveBeenCalledWith({ itemId: "i1", reason: "not_dq_paper" });
  });
});
