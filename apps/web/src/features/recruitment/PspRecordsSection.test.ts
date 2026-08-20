import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { PSP_SOURCE_API, PSP_SOURCE_IMPORT } from "@fuelguard/shared";
import PspRecordsSection from "@/features/recruitment/PspRecordsSection.vue";

/**
 * P14's two user-visible promises.
 *
 * First, an imported record must never show a count. The PDF has been read by nobody, and rendering
 * "0 inspections" where the ordered path renders a real projection would put a claim about a driver
 * on screen that nothing supports (D-PSP5).
 *
 * Second, the affordance follows the API guard. A fleet_manager manages the Recruitment section and
 * is refused by the import endpoints — showing them the button would offer an action that 403s.
 */

const RECORDS = [
  {
    id: "r-imported",
    driver_id: "d1",
    kind: "psp_report",
    occurred_on: "2025-06-02",
    covers_until: null,
    result: "imported",
    performed_by: null,
    reference: "PSP-88231",
    document_id: "doc-1",
    detail: { source: PSP_SOURCE_IMPORT, structured: false },
    created_at: "2026-08-19T00:00:00Z",
  },
  {
    id: "r-ordered",
    driver_id: "d1",
    kind: "psp_report",
    occurred_on: "2026-08-19",
    covers_until: null,
    result: "clean",
    performed_by: null,
    reference: "auth-1",
    document_id: "doc-2",
    detail: { source: PSP_SOURCE_API, inspections: 3, crashes: 0 },
    created_at: "2026-08-19T00:00:00Z",
  },
  /**
   * A record from before `source` was written (P9). It must NOT be read as ordered on the strength
   * of carrying counts: the field is the fact, and an absent one is answered "not recorded".
   */
  {
    id: "r-legacy",
    driver_id: "d1",
    kind: "psp_report",
    occurred_on: "2026-03-01",
    covers_until: null,
    result: "clean",
    performed_by: null,
    reference: "auth-legacy",
    document_id: null,
    detail: {},
    created_at: "2026-03-01T00:00:00Z",
  },
  // A different kind on the same driver — the section shows PSP and nothing else.
  {
    id: "r-mvr",
    driver_id: "d1",
    kind: "mvr",
    occurred_on: "2026-01-01",
    covers_until: null,
    result: null,
    performed_by: null,
    reference: null,
    document_id: null,
    detail: {},
    created_at: "2026-01-01T00:00:00Z",
  },
];

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async () => ({ ok: true, data: { records: RECORDS } })),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { storage: { from: () => ({}) }, auth: { getSession: async () => ({ data: { session: null } }) } },
  DEV_BYPASS: false,
}));

const role = vi.hoisted(() => ({ value: "recruiter" as string | null }));
vi.mock("@/stores/session", () => ({
  useSessionStore: () => ({ get role() { return role.value; } }),
}));

const mountSection = () =>
  mount(PspRecordsSection, {
    props: { driverId: "00000000-0000-4000-8000-0000000000d1" },
    global: { plugins: [VueQueryPlugin], stubs: { SlideOver: true, teleport: true } },
  });

const settle = async (w: ReturnType<typeof mountSection>) => {
  for (let i = 0; i < 10; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};

describe("PSP records on the driver page", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    role.value = "recruiter";
  });

  it("says an imported record was not machine-read rather than showing it as zero", async () => {
    const w = mountSection();
    await settle(w);
    const text = w.text();
    expect(text).toContain("Not machine-read");
    expect(text).toContain("3 inspections · 0 crashes");
    expect(text).not.toContain("0 inspections");
  });

  it("says a record with no recorded source is not recorded, rather than guessing", async () => {
    const w = mountSection();
    await settle(w);
    expect(w.text()).toContain("Source not recorded");
  });

  it("shows only PSP records, whatever else is in the file", async () => {
    const w = mountSection();
    await settle(w);
    expect(w.text()).toContain("PSP-88231");
    expect(w.text()).not.toContain("r-mvr");
  });

  it("offers the import to a recruiter", async () => {
    const w = mountSection();
    await settle(w);
    expect(w.findAll("button").some((b) => b.text().includes("Import a PSP record"))).toBe(true);
  });

  /** Manages the section, may not read investigation history — the one role the API refuses. */
  it("does not offer it to a fleet_manager", async () => {
    role.value = "fleet_manager";
    const w = mountSection();
    await settle(w);
    expect(w.findAll("button").some((b) => b.text().includes("Import a PSP record"))).toBe(false);
  });
});
