import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

/**
 * Settings → Notifications (Q-AW52, ruled (a) by the owner 2026-09-29). Its one checkbox is
 * `organizations.notifications_enabled`, which every carrier alert reads — it used to be labelled as the
 * anomaly emails alone, so turning it off to stop those silenced the office's stalled-application alert
 * and the rest without a word. Pinned: it is named as the carrier's alerts, and the page says what it stops,
 * including the one alert that ignores it.
 */
vi.mock("@/composables/useOrgSettings", () => ({
  useOrgSettingsQuery: () => ({
    data: ref({ name: "Silvicom Inc", notifications_enabled: true, notification_emails: ["ops@silvicominc.com"] }),
    isLoading: ref(false),
  }),
  useSaveOrgSettings: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
}));

const NotificationsPage = (await import("@/pages/NotificationsPage.vue")).default;

describe("the carrier's alert switch", () => {
  it("is named as all of the carrier's alerts, not the anomaly emails alone", () => {
    setActivePinia(createPinia());
    const w = mount(NotificationsPage, { global: { stubs: { PageHeader: true } } });
    expect(w.text()).toContain("Send the carrier's alerts");
    expect(w.text()).not.toContain("when high/critical anomalies are detected");
  });

  it("says what it stops — the stalled-application alert among them — and the one alert it does not", () => {
    setActivePinia(createPinia());
    const w = mount(NotificationsPage, { global: { stubs: { PageHeader: true } } });
    for (const alert of [
      "high and critical anomalies",
      "drivers who stopped part-way through an application",
      "driver qualification expirations",
      "the weekly digest",
      "fuel and finance data that has stopped arriving",
      "a stalled Samsara feed",
      "an EFS certificate about to expire",
    ]) {
      expect(w.text(), alert).toContain(alert);
    }
    expect(w.text()).toContain("An EFS certificate that has already expired is emailed even when this is off");
  });
});
