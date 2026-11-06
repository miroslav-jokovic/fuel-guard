import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { JOB_KIND_CATALOGUE } from "@silvicom/shared";

/**
 * The failed-jobs card (E5) over the real `GET /api/jobs/failed` shape, in the three fixtures the step asks for:
 * the read failing, nothing failed, and a forced failure listed in office words. The words are the shared
 * catalogue's, read here from it, so a relabel cannot make this test pass for the wrong reason.
 */
const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api", () => api);
import FailedJobsCard from "./FailedJobsCard.vue";

const mountCard = async () => {
  const w = mount(FailedJobsCard, { global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]] } });
  await flushPromises();
  return w;
};

const FAILED = {
  id: "j1", kind: "ads_insights", attempts: 5, max_attempts: 5,
  error: "ads_insights: 1 not brought in (0 hours written, 0 zeroed, 0 paused) — account:token_invalid",
  payload: { connectionId: "7c0e0c1a-2d3e-4f50-8a6b-7c8d9e0f1a2b", days: 3 },
  finished_at: "2026-11-06T14:05:00.000Z", created_at: "2026-11-06T13:00:00.000Z",
};

beforeEach(() => api.apiFetch.mockReset());

describe("FailedJobsCard", () => {
  it("lists a forced failure in office words: what, its area and item, when, tries, what to do, and the server's error", async () => {
    api.apiFetch.mockResolvedValue({ ok: true, data: [FAILED] });
    const w = await mountCard();
    expect(api.apiFetch).toHaveBeenCalledWith("/api/jobs/failed?limit=50");
    const text = w.text();
    const entry = JOB_KIND_CATALOGUE.ads_insights;
    for (const s of [entry.label, "Recruiting ads", "Ad account", "7c0e0c1a", "11/06/2026", "5 of 5", entry.hint, "account:token_invalid"]) expect(text, s).toContain(s);
    expect(w.find("[title='7c0e0c1a-2d3e-4f50-8a6b-7c8d9e0f1a2b']").exists()).toBe(true);
  });

  it("nothing failed: says so, not a blank table", async () => {
    api.apiFetch.mockResolvedValue({ ok: true, data: [] });
    expect((await mountCard()).text()).toContain("No background job has failed.");
  });

  it("the read itself failing is a failure with a Retry, not 'nothing failed'", async () => {
    api.apiFetch.mockResolvedValue({ ok: false, error: { message: "Forbidden" } });
    const w = await mountCard();
    expect(w.text()).toContain("Could not load the failed jobs.");
    expect(w.text()).not.toContain("No background job has failed.");
    const retry = w.findAll("button").find((b) => /retry/i.test(b.text()));
    expect(retry).toBeTruthy();
    api.apiFetch.mockResolvedValue({ ok: true, data: [FAILED] });
    await retry!.trigger("click");
    await flushPromises();
    expect(w.text()).toContain(JOB_KIND_CATALOGUE.ads_insights.label);
  });

  it("a job with no item, a kind this build does not know, and no error text are each still shown", async () => {
    api.apiFetch.mockResolvedValue({ ok: true, data: [
      { ...FAILED, id: "j2", kind: "ads_daily_brief", payload: {}, error: null },
      { ...FAILED, id: "j3", kind: "some_new_job", payload: {} },
    ] });
    const text = (await mountCard()).text();
    expect(text).toContain(JOB_KIND_CATALOGUE.ads_daily_brief.label);
    expect(text).toContain("No error text was recorded.");
    expect(text).toContain("some new job");
  });
});
