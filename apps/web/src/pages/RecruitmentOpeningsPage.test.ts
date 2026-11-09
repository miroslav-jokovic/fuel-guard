import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { HIRING_PROFILE_V1, type OpeningView } from "@silvicom/shared";
import PlaceSearchField from "@/features/recruitment/PlaceSearchField.vue";
import RecruitmentOpeningsPage from "@/pages/RecruitmentOpeningsPage.vue";

/**
 * Recruitment › Openings (Q-AD43 (b), Q-AD44 (a)) over a stubbed `apiFetch`: the three fixtures (failed, empty,
 * saved), the first hiring profile saved from the defaults the API sent, and each write sent to its door.
 */
const session = vi.hoisted(() => ({ can: (_s: string): boolean => true }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => session }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));
const api = vi.hoisted(() => ({ calls: [] as Array<{ path: string; body?: unknown }>, answer: null as null | ((path: string, body?: unknown) => unknown) }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string, init?: { body?: unknown }) => {
    api.calls.push({ path, body: init?.body });
    return api.answer!(path, init?.body);
  }),
}));

const PV = "70000000-0000-4000-8000-000000000001";
const OPENING = "60000000-0000-4000-8000-000000000001";
const DANA = "10000000-0000-4000-8000-0000000000da";
const SAM = "10000000-0000-4000-8000-00000000005a";
const SAVED: OpeningView = {
  id: OPENING, status: "open", created_at: "2026-11-06T00:00:00Z", recruiter_id: null,
  current: {
    id: "ov2", version: 2, profile_version_id: PV, title: "Class A regional", headcount: 3,
    facts: { pay: { per: "mile", min_cents: 62, max_cents: 70 }, home_time: "Home weekly", equipment: ["dry_van"], lanes: null, start_date: null },
    area_label: "Joliet, IL", area_latitude: 41.525, area_longitude: -88.0817, area_radius_miles: 50, area_reason: "Home weekly from the yard",
    created_by_name: "Dana Recruiter", created_at: "2026-11-06T15:00:00Z",
  },
};
const PROFILE = { id: "p1", name: "Class A regional", archived_at: null, created_at: "2026-11-06T00:00:00Z", current: { id: PV, version: 1, requirements: HIRING_PROFILE_V1, created_by_name: "Dana", created_at: "2026-11-06T00:00:00Z" } };
const ok = (data: unknown) => ({ ok: true, data });

function world(openings: OpeningView[] | "fail", profiles: unknown[] = []) {
  return (path: string) => {
    if (path === "/api/recruitment/openings") return openings === "fail" ? { ok: false, error: { message: "boom" } } : ok({ openings });
    if (path === "/api/recruitment/hiring-profiles") return ok({ profiles, defaults: HIRING_PROFILE_V1 });
    if (path.endsWith("/status")) return ok({ id: OPENING, status: "paused" });
    if (path === "/api/recruitment/recruiters") return ok({ recruiters: [{ user_id: DANA, label: "Dana Recruiter" }, { user_id: SAM, label: "Sam Ortiz" }] });
    if (path.endsWith("/recruiter")) return ok({ id: OPENING });
    return { ok: false, error: { message: "not stubbed" } };
  };
}
/** The control a `data-test` names: the element itself when the primitive passed it through, else the one inside. */
const control = (w: ReturnType<typeof mount>, test: string) => {
  const el = w.find(`[data-test="${test}"]`);
  return ["INPUT", "SELECT", "TEXTAREA"].includes(el.element.tagName) ? el : el.find("input, select, textarea");
};
const posts = (path: string) => api.calls.filter((c) => c.path === path && c.body !== undefined).map((c) => c.body);

const SlideOverStub = { props: ["open", "title"], template: "<div v-if='open' data-test='drawer'><h2>{{ title }}</h2><slot /><slot name='footer' /></div>" };
async function settle(w: { vm: { $nextTick: () => Promise<void> } }) {
  for (let i = 0; i < 12; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
}
async function render(at: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ["recruitment", "recruitment-leads", "recruitment-openings", "recruitment-campaigns", "screening-readiness", "inquiry-queue", "recruitment-templates"]
      .map((name) => ({ path: name === "recruitment-openings" ? "/recruitment/openings" : `/x/${name}`, name, component: { template: "<div />" } })),
  });
  await router.push(at);
  await router.isReady();
  const w = mount(RecruitmentOpeningsPage, {
    global: {
      plugins: [router, [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]],
      stubs: { PageHeader: { template: "<div />" }, SlideOver: SlideOverStub, KebabMenu: { template: "<div><slot /></div>" } },
    },
  });
  await settle(w);
  return { w, router };
}

beforeEach(() => {
  setActivePinia(createPinia());
  api.calls = [];
  session.can = () => true;
});

describe("Recruitment › Openings", () => {
  it("says the openings could not be loaded when the read fails", async () => {
    api.answer = world("fail");
    expect((await render("/recruitment/openings")).w.text()).toContain("Could not load the openings.");
  });

  it("with no profile yet, shows the defaults the API sent and saves them as the first profile when a person asks", async () => {
    let saved = false;
    api.answer = (path, body) => {
      if (path === "/api/recruitment/hiring-profiles" && body) {
        saved = true;
        return ok({ profile_id: "p1", version_id: PV, version: 1 });
      }
      return world([], saved ? [PROFILE] : [])(path);
    };
    const { w } = await render("/recruitment/openings");
    expect(w.text()).toContain("No openings yet. Add one to start a campaign.");
    await w.find('[data-test="new-opening"]').trigger("click");
    await settle(w);
    expect(w.find('[data-test="profile-defaults"]').text()).toContain(HIRING_PROFILE_V1.min_age.reason);
    expect(posts("/api/recruitment/hiring-profiles")).toEqual([]);
    await control(w, "profile-name").setValue("Class A regional");
    await w.find('[data-test="save-first-profile"]').trigger("click");
    await settle(w);
    expect(posts("/api/recruitment/hiring-profiles")).toEqual([{ profile_id: null, name: "Class A regional", requirements: HIRING_PROFILE_V1 }]);
    // …and the profile just saved is the one the opening names.
    expect((control(w, "profile-select").element as HTMLSelectElement).value).toBe(PV);
  });

  it("a new opening is saved with the picked place's point and the chosen profile", async () => {
    api.answer = (path, body) => (path === "/api/recruitment/openings" && body ? ok({ opening_id: OPENING, version: 1 }) : world([], [PROFILE])(path));
    const { w } = await render("/recruitment/openings?opening=new");
    for (const [k, v] of [["opening-title", "Class A regional"], ["pay-min", "0.62"], ["home-time", "Home weekly"], ["radius", "50"], ["area-reason", "Home weekly from the yard"]]) {
      await control(w, k!).setValue(v);
    }
    await control(w, "equipment-dry_van").setValue(true);
    w.findComponent(PlaceSearchField).vm.$emit("select", { label: "Joliet, IL, United States", lat: 41.525, lng: -88.0817 });
    await settle(w);
    await control(w, "profile-select").setValue(PV);
    await w.find('[data-test="opening-form"]').trigger("submit");
    await settle(w);
    expect(posts("/api/recruitment/openings")).toEqual([{
      opening_id: null, profile_version_id: PV, title: "Class A regional", headcount: null,
      facts: { pay: { per: "mile", min_cents: 62, max_cents: null }, home_time: "Home weekly", equipment: ["dry_van"], lanes: null, start_date: null },
      area: { label: "Joliet, IL, United States", latitude: 41.525, longitude: -88.0817, radius_miles: 50, reason: "Home weekly from the yard" },
    }]);
  });

  it("lists a saved opening with its status, version and who saved it last, and moves its status through the door", async () => {
    api.answer = world([SAVED], [PROFILE]);
    const { w } = await render("/recruitment/openings");
    const text = w.text();
    expect(["Class A regional", "Open", "Dana Recruiter"].every((s) => text.includes(s))).toBe(true);
    await w.find(`[data-test="move-${OPENING}-paused"]`).trigger("click");
    await settle(w);
    expect(posts(`/api/recruitment/openings/${OPENING}/status`)).toEqual([{ status: "paused" }]);
  });

  it("opens a saved opening as its next version", async () => {
    api.answer = (path, body) => (path === "/api/recruitment/openings" && body ? ok({ opening_id: OPENING, version: 3 }) : world([SAVED], [PROFILE])(path));
    const { w } = await render(`/recruitment/openings?opening=${OPENING}`);
    expect(w.find('[data-test="save-opening"]').text()).toBe("Save as version 3");
    await w.find('[data-test="opening-form"]').trigger("submit");
    await settle(w);
    expect(posts("/api/recruitment/openings")).toMatchObject([{ opening_id: OPENING, profile_version_id: PV, area: { latitude: 41.525 } }]);
  });

  it("a view-only role can read the list but is offered no new opening and no status move", async () => {
    session.can = () => false;
    api.answer = world([SAVED], [PROFILE]);
    const { w } = await render("/recruitment/openings");
    expect([w.find('[data-test="new-opening"]').exists(), w.find(`[data-test="move-${OPENING}-paused"]`).exists(), w.text().includes("Class A regional")])
      .toEqual([false, false, true]);
  });

  it("names the opening's recruiter through its door, and hands it back to everyone (LQ2b, Q-AD50 (a))", async () => {
    api.answer = world([SAVED]);
    const { w } = await render("/recruitment/openings");
    const select = control(w, `recruiter-${OPENING}`);
    expect(select.findAll("option").map((o) => o.text())).toEqual(["Everyone in recruiting", "Dana Recruiter", "Sam Ortiz"]);
    await select.setValue(SAM);
    await settle(w);
    expect(posts(`/api/recruitment/openings/${OPENING}/recruiter`)).toEqual([{ recruiter_id: SAM }]);
    api.answer = world([{ ...SAVED, recruiter_id: SAM }]);
    const again = await render("/recruitment/openings");
    await control(again.w, `recruiter-${OPENING}`).setValue("");
    await settle(again.w);
    expect(posts(`/api/recruitment/openings/${OPENING}/recruiter`).at(-1)).toEqual({ recruiter_id: null });
  });

  it("a recruiter who lost recruiting access is shown as such, never as everyone's", async () => {
    api.answer = world([{ ...SAVED, recruiter_id: "10000000-0000-4000-8000-0000000000ff" }]);
    const { w } = await render("/recruitment/openings");
    const select = control(w, `recruiter-${OPENING}`);
    expect((select.element as HTMLSelectElement).selectedOptions[0]?.textContent?.trim()).toBe("Someone without recruiting access");
    session.can = () => false;
    const ro = await render("/recruitment/openings");
    expect(ro.w.find(`[data-test="recruiter-${OPENING}"]`).text()).toBe("Someone without recruiting access");
  });

  it("a view-only role reads the recruiter's name, with nothing to change", async () => {
    session.can = () => false;
    api.answer = world([{ ...SAVED, recruiter_id: DANA }]);
    const { w } = await render("/recruitment/openings");
    const cell = w.find(`[data-test="recruiter-${OPENING}"]`);
    expect([cell.element.tagName, cell.text()]).toEqual(["SPAN", "Dana Recruiter"]);
  });
});
