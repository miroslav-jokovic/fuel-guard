import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import type { CareersListView } from "@silvicom/shared";
import CareersListPage from "@/pages/CareersListPage.vue";
import { CAREERS_COPY } from "@/features/careers";

/** `/careers/:handle` (APPLY-PAGE-PLAN D-AP1, D-AP7): the carrier's published openings, the notices, and the 404. */
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRoute: () => ({ params: { handle: "silvicom" } }),
}));

const LIST: CareersListView = {
  carrier: "Silvicom Inc",
  handle: "silvicom",
  openings: [
    { id: "o1", title: "Regional dry van", pay: { per: "mile", min_cents: 60, max_cents: 75 }, areaLabel: "Chicago, IL", equipment: ["dry_van"], schedule: "regional" },
    { id: "o2", title: "Local flatbed", pay: { per: "hour", min_cents: 2_800, max_cents: 3_200 }, areaLabel: "Joliet, IL", equipment: ["flatbed"], schedule: null },
  ],
  accommodation: { email: null, phone: "+17082365732" },
  pageUrl: "https://careers.example.test/careers/silvicom",
  legalOrigin: "https://360.example.test",
};
const state = vi.hoisted(() => ({ body: null as unknown, status: 200 }));

beforeEach(() => {
  Object.assign(state, { body: LIST, status: 200 });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    expect(url).toBe("/api/public/careers/silvicom");
    return new Response(JSON.stringify(state.body), { status: state.status });
  }));
});
afterEach(() => vi.unstubAllGlobals());
enableAutoUnmount(afterEach);

const mountPage = async () => {
  const w = mount(CareersListPage, { global: { plugins: [VueQueryPlugin], stubs: { RouterLink: { props: ["to"], template: "<a data-router-link :data-to='JSON.stringify(to)'><slot /></a>" } } } });
  for (let i = 0; i < 12; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
  return w;
};

describe("the careers list", () => {
  it("each opening is its own titled link with its pay range; the page names the carrier", async () => {
    const w = await mountPage();
    expect(w.find("h1").text()).toBe("Driving jobs at Silvicom Inc");
    const items = w.findAll("[data-openings] li");
    expect(items.map((li) => li.find("[data-router-link]").text())).toEqual(["Regional dry van", "Local flatbed"]);
    expect(items.map((li) => li.find("[data-pay]").text())).toEqual(["$0.60–$0.75 per mile", "$28–$32 per hour"]);
    expect(JSON.parse(items[0]!.find("[data-router-link]").attributes("data-to")!)).toEqual({ name: "careers-job", params: { handle: "silvicom", openingId: "o1" } });
    expect(w.emitted("carrier")?.at(-1)).toEqual(["Silvicom Inc"]);
  });

  it("the notices: the EEO statement, the EEOC's poster, the accommodation contact, and the legal pages on the office host", async () => {
    const w = await mountPage();
    const footer = w.find("[data-careers-footer]");
    expect(footer.find("[data-eeo]").text()).toContain("Silvicom Inc is an equal opportunity employer.");
    const hrefs = footer.findAll("a").map((a) => a.attributes("href"));
    expect(hrefs).toEqual(["tel:+17082365732", "https://360.example.test/privacy#careers-page", "https://360.example.test/sms-terms", "https://www.eeoc.gov/poster"]);
    expect(footer.find("[data-accommodation]").text()).toBe("(708) 236-5732");
  });

  it("no openings: says so, and still carries the notices", async () => {
    state.body = { ...LIST, openings: [] };
    const w = await mountPage();
    expect(w.find("[data-no-openings]").text()).toContain(CAREERS_COPY.list.none);
    expect(w.find("[data-careers-footer]").exists()).toBe(true);
  });

  it("a page that is off reads as not available", async () => {
    state.status = 404;
    state.body = { error: { code: "not_found", message: "x" } };
    const w = await mountPage();
    expect(w.find("[data-careers-not-found] h1").text()).toBe(CAREERS_COPY.notFound.heading);
  });
});
