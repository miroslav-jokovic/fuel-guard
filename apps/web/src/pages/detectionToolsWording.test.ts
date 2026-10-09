import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { computeDetectionCoverage } from "@silvicom/shared";
import { SETTINGS_CARDS } from "@/lib/settingsCards";

/**
 * The three detection tools an admin reaches from Settings — Recall audit, Detection coverage and
 * Anomaly thresholds — in plain words (F02-F04 PLAN.md chunk 14c; AUDIT.md W2's last three lines,
 * moved here from 14a). Each page, and its card on the Settings page, is held to one list of words
 * an office reader would have to look up.
 *
 * Coverage is rendered with a real summary of one truck's fills (`computeDetectionCoverage`), so its
 * tiles and table render rather than an empty state that has none of the words.
 */
const JARGON = [
  /anomaly engine/i, /detection engine/i, /\bprecision\b/i, /\brecall\b/i, /false negative/i,
  /\bblind\b/i, /\bcorroborat/i, /\btelematics\b/i, /95% CI/, /\bcovered clears\b/i, /\btune\b/i,
];
const offenders = (text: string) => JARGON.filter((re) => re.test(text)).map(String);

vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true, canView: () => true, role: "admin" }) }));
vi.mock("@/composables/useOpens", () => ({ useOpens: () => () => true }));
vi.mock("@/composables/useVehicles", async () => {
  const { ref } = await import("vue");
  return { useVehiclesQuery: () => ({ data: ref([{ id: "v1", unit_number: "654" }]) }) };
});
vi.mock("@/features/anomalies/useRecallAudit", async () => {
  const { ref } = await import("vue");
  const fill = { id: "f1", vehicleId: "v1", fueledAt: "2026-10-01T12:00:00Z", gallons: 100, totalCost: 380, computedMpg: 6.5, odometer: 1000, observedCity: "Joliet", observedState: "IL" };
  return {
    useAuditSample: () => ({ data: ref([fill]), isLoading: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn(), isFetching: ref(false) }),
    useRecallMetrics: () => ({
      data: ref({ audited: 40, missed: 2, estimatedRecall: 0.9, recallLow: 0.8, recallHigh: 0.95, missRate: 0.05, missRateCiLow: 0.01, missRateCiHigh: 0.12, estimatedMisses: 30, coveredClears: 600 }),
    }),
    useRecordVerdict: () => ({ isPending: ref(false), mutateAsync: vi.fn() }),
  };
});
const coverage = vi.hoisted(() => ({ summary: null as unknown }));
vi.mock("@/features/fuel/useDetectionCoverage", async () => {
  const { ref } = await import("vue");
  return {
    useDetectionCoverage: () => ({
      data: ref(coverage.summary), isLoading: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn(), isFetching: ref(false),
    }),
    useCapacityHealth: () => ({ data: ref({ setPct: 100, missing: [], divergent: [] }) }),
  };
});
vi.mock("@/features/settings/useThresholds", async () => {
  const { ref } = await import("vue");
  return { useThresholdsQuery: () => ({ data: ref(null), isLoading: ref(false) }), useSaveThresholds: () => ({ isPending: ref(false), mutateAsync: vi.fn() }) };
});
vi.mock("@/components/SamsaraFeedLine.vue", () => ({ default: { template: "<div />" } }));

async function render(page: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { template: "<div/>" } }] });
  const { default: Page } = await import(`./${page}.vue`);
  const w = mount(Page, { global: { plugins: [router] } });
  await flushPromises();
  return w;
}

describe("the detection tools speak plainly (W2)", () => {
  it("Recall audit says what it measures without precision, recall or a confidence interval", async () => {
    const w = await render("RecallAuditPage");
    expect(w.text()).toContain("This page measures how much the system");
    expect(w.text()).toContain("likely between 1% and 12%");
    expect(offenders(w.text())).toEqual([]);
  });

  it("Detection coverage names unmatched fills instead of blind spots", async () => {
    const summary = computeDetectionCoverage([]);
    coverage.summary = {
      ...summary, totalFills: 10, blindFills: 3,
      perTruck: [{ ...summary.perTruck[0], vehicleId: "v1", fills: 10, blindFills: 3, blindPct: 30, reconciledPct: 70, locationPct: 60, odometerPct: 50, attributedPct: 100 }],
    };
    const w = await render("CoveragePage");
    expect(w.text()).toContain("3 of 10 fills not matched");
    expect(w.text()).toContain("Not matched");
    expect(offenders(w.text())).toEqual([]);
  });

  it("Anomaly thresholds says what a limit does, not that an engine is tuned", async () => {
    const w = await render("ThresholdsPage");
    expect(w.text()).toContain("Set the limits that decide when a fill is flagged.");
    expect(offenders(w.text())).toEqual([]);
  });

  it("the three Settings cards describe the tools the same way", () => {
    const keys = ["admin.recall-audit", "admin.coverage", "admin.settings.thresholds"];
    const descs = SETTINGS_CARDS.filter((c) => keys.includes(c.key)).map((c) => c.desc);
    expect(descs).toHaveLength(3);
    expect(offenders(descs.join(" "))).toEqual([]);
  });
});
