import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

/**
 * The entity-history panel in the anomaly drawer (D-US5). A failed read must not look like a case
 * with no history: it says it could not load and reads both endpoints again on Retry. A 404 from
 * pattern-report is how the API says "no report yet", so it stays the empty line, not a failure.
 */
const api = vi.hoisted(() => ({ riskFails: false, gets: [] as string[] }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string) => {
    api.gets.push(url);
    if (url.endsWith("/risk-context")) {
      return api.riskFails
        ? { ok: false, status: 500, error: { message: "boom" } }
        : { ok: true, status: 200, data: { driver: null, vehicle: null, card: null, windows: { dispositionDays: 90, activityDays: 30, nearThresholdScore: 40 } } };
    }
    return { ok: false, status: 404, error: { message: "No pattern report for this case yet" } };
  }),
}));
import EntityHistory from "./EntityHistory.vue";

beforeEach(() => {
  api.riskFails = false;
  api.gets.length = 0;
});

describe("EntityHistory", () => {
  it("treats a missing pattern report as no analysis yet, not as a failure", async () => {
    const w = mount(EntityHistory, { props: { anomalyId: "a1" }, global: { stubs: { CaseTimeline: true } } });
    await flushPromises();
    expect(w.find("[role=alert]").exists()).toBe(false);
    expect(w.text()).toContain("No pattern analysis yet");
  });

  it("says the history could not load and reads it again on Retry", async () => {
    api.riskFails = true;
    const w = mount(EntityHistory, { props: { anomalyId: "a1" }, global: { stubs: { CaseTimeline: true } } });
    await flushPromises();
    const alert = w.get("[role=alert]");
    expect(alert.text()).toContain("Could not load this case's entity history.");
    expect(w.text()).not.toContain("No pattern analysis yet");
    api.gets.length = 0;
    api.riskFails = false;
    await alert.findAll("button").find((b) => b.text() === "Retry")!.trigger("click");
    await flushPromises();
    expect(api.gets.sort()).toEqual(["/api/anomalies/a1/pattern-report", "/api/anomalies/a1/risk-context"]);
    expect(w.find("[role=alert]").exists()).toBe(false);
  });
});
