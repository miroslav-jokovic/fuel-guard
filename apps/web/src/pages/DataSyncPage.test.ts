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

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async () =>
    fetched.ok
      ? { ok: true, data: fetched.value }
      : { ok: false, error: { message: "Could not read the webhook status" } },
  ),
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

beforeEach(() => {
  fetched.value = status();
  fetched.ok = true;
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
