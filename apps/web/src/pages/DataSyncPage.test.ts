import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";

/**
 * The Data & sync console, mounted — specifically, the fuel-drop webhook card.
 *
 * WHY THIS SUITE EXISTS. The receiver had two live defects (a vendor URL pointing at the mount prefix
 * rather than the route, and an unset signing secret) and between them `fuel_events` held 0 rows for
 * six months. Neither defect was a code bug and neither is fixed here; what WAS missing from the code
 * is that no screen distinguished "no siphoning happened" from "nothing can reach us". These three
 * states are the whole point of the card, so they are what is pinned.
 */

const fetched = { value: null as Record<string, unknown> | null, ok: true };
const coverageFetched = { value: null as Record<string, unknown> | null, ok: true };

// The page makes TWO independent calls, so the fake dispatches on the path. It used to answer every
// call with the webhook payload, which meant adding a second card silently fed that card the wrong
// shape and took the whole page down — four assertions failed for a reason none of them was about.
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string) => {
    // S5's card. Without this branch it receives the webhook payload — the exact defect the note
    // above records, one card later.
    if (url.includes("feed-freshness")) {
      return { ok: true, data: { feeds: [], alerting: [], error: null } };
    }
    if (url.includes("telematics-coverage")) {
      return coverageFetched.ok
        ? { ok: true, data: coverageFetched.value }
        : { ok: false, error: { message: "Could not read telematics coverage" } };
    }
    return fetched.ok
      ? { ok: true, data: fetched.value }
      : { ok: false, error: { message: "Could not read the webhook status" } };
  }),
}));

vi.mock("@/features/jobs/useJob", () => ({
  useJob: () => ({
    lastDone: ref(null),
    failed: ref(false),
    freshnessLabel: ref("never run"),
  }),
}));

import DataSyncPage from "./DataSyncPage.vue";

const status = (o: Record<string, unknown> = {}) => ({
  secretConfigured: true,
  endpointPath: "/api/webhooks/samsara",
  endpointUrl: "https://api.example.test/api/webhooks/samsara",
  eventCount: 0,
  lastEventAt: null,
  ...o,
});

const coverage = (o: Record<string, unknown> = {}) => ({
  fills: 100,
  reconciled: 60,
  noData: 10,
  pending: 30,
  coveragePct: 60,
  attainablePct: 85.7,
  truncated: false,
  byMonth: [
    { month: "2026-08", fills: 50, reconciled: 48, noData: 2, pending: 0, coveragePct: 96 },
    { month: "2026-01", fills: 50, reconciled: 12, noData: 8, pending: 30, coveragePct: 24 },
  ],
  ...o,
});

beforeEach(() => {
  fetched.value = status();
  fetched.ok = true;
  coverageFetched.value = coverage();
  coverageFetched.ok = true;
});

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/settings/data", component: { template: "<div/>" }, meta: { title: "Data & Sync" } }],
  });
  await router.push("/settings/data");
  await router.isReady();
  const pinia = createPinia();
  setActivePinia(pinia);
  const w = mount(DataSyncPage, {
    global: { plugins: [router, pinia], stubs: { JobActionCard: true } },
  });
  await flushPromises();
  return w;
}

describe("DataSyncPage — the fuel-drop webhook card", () => {
  it("says the receiver cannot work at all when the signing secret is missing", async () => {
    fetched.value = status({ secretConfigured: false });
    const t = (await mountPage()).text();
    expect(t).toContain("Not receiving");
    expect(t).toContain("SAMSARA_WEBHOOK_SECRET");
  });

  // The state that hid for six months: configured, plausible, and completely silent.
  it("distinguishes 'configured but nothing has ever arrived' from a quiet week", async () => {
    fetched.value = status({ eventCount: 0 });
    const t = (await mountPage()).text();
    expect(t).toContain("no event has ever arrived");
    expect(t).not.toContain("Not receiving");
  });

  it("shows the last event once one has arrived, and the total received", async () => {
    fetched.value = status({ eventCount: 7, lastEventAt: "2026-08-30T12:00:00Z" });
    const t = (await mountPage()).text();
    expect(t).toContain("Last event");
    expect(t).toContain("7 event(s) received in total.");
    expect(t).not.toContain("no event has ever arrived");
  });

  // The defect was a URL somebody reconstructed. Print it whole so the next person pastes it.
  it("prints the exact address Samsara must post to", async () => {
    const t = (await mountPage()).text();
    expect(t).toContain("https://api.example.test/api/webhooks/samsara");
  });
});

/**
 * The telematics-history card (SAM-S4, D-SAM7).
 *
 * The Coverage page computes the same idea over 90 days and reads ~95%; against the whole history the
 * figure was 23%, because 76.8% of fills had never been fetched. So what this card has to do is show
 * the gap and say which KIND of gap it is — a backlog the collector is draining, or a dead end at the
 * vendor that never improves. Those need different actions and only one of them is worth waiting for.
 */
describe("DataSyncPage — the telematics-history card", () => {
  it("leads with the all-time figure and separates the backlog from the dead end", async () => {
    const t = (await mountPage()).text();
    expect(t).toContain("60%");
    expect(t).toContain("60 of 100 fills checked");
    expect(t).toContain("30 still to fetch");
    expect(t).toContain("10 came back with nothing on Samsara's side");
  });

  it("says where coverage lands once the backlog clears, so 60% is not read as the end state", async () => {
    expect((await mountPage()).text()).toContain("85.7%");
  });

  it("does not promise a landing figure when there is no backlog to clear", async () => {
    coverageFetched.value = coverage({ pending: 0, attainablePct: 100 });
    const t = (await mountPage()).text();
    expect(t).not.toContain("once the backlog clears");
  });

  it("lists every month it holds a fill for, each with its own rate", async () => {
    const t = (await mountPage()).text();
    expect(t).toContain("96%"); // August — recent months are near-complete
    expect(t).toContain("24%"); // January — the old end, where the vendor gap lives
  });

  it("says the number is a floor when the read stopped early, rather than showing it as final", async () => {
    coverageFetched.value = coverage({ truncated: true });
    expect((await mountPage()).text()).toContain("this is a floor");
  });

  it("reports a failed read instead of rendering 0% coverage", async () => {
    coverageFetched.ok = false;
    const t = (await mountPage()).text();
    expect(t).toContain("Could not read telematics coverage");
  });
});
