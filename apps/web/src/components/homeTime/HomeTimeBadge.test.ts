import { describe, expect, it } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import HomeTimeBadge from "./HomeTimeBadge.vue";

/** The badge is the way in (HOME-TIME-VISIBILITY-PLAN D-HT25): one click opens the driver's drawer. */
const DRIVER = "f1a81ef1-f313-4ffa-be57-7b452306915e";
const period = { driverId: DRIVER, driverName: "LEONARD BURRELL", startAt: "2026-11-16T21:32:00Z", expectedReturnAt: "2026-11-24T21:32:00Z" };

async function mountBadge(state: "scheduled" | "active" | "overdue" | "ended") {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/drivers", component: { template: "<div />" } }] });
  await router.push("/drivers?q=676");
  const w = mount(HomeTimeBadge, { props: { period: { ...period, state }, zone: "America/Chicago" }, global: { plugins: [router] } });
  return { w, router };
}

describe("HomeTimeBadge", () => {
  it("says the status and opens that driver's home time, keeping the page's own query", async () => {
    const { w, router } = await mountBadge("overdue");
    expect(w.text()).toBe("Overdue since 11/24");
    await w.get("[data-home-time-badge]").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ q: "676", homeTime: DRIVER });
  });

  it("renders nothing for a period that is over", async () => {
    const { w } = await mountBadge("ended");
    expect(w.find("[data-home-time-badge]").exists()).toBe(false);
  });
});
