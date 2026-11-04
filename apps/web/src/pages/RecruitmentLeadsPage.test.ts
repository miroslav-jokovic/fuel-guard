import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import LeadDrawer from "@/features/recruitment/LeadDrawer.vue";
import RecruitmentLeadsPage from "@/pages/RecruitmentLeadsPage.vue";

/**
 * The lead queue and drawer (E4b) over a stubbed `apiFetch`: what each read shows, and that the URL drives it.
 * A notification's link is the case the drawer's own read exists for, so the lead it opens here is on no page.
 */
const api = vi.hoisted(() => ({ calls: [] as string[], answer: null as null | ((path: string) => unknown) }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string) => {
    api.calls.push(path);
    return api.answer!(path);
  }),
}));

const ROW = {
  id: "lead-1", channel: "meta", source: "instant_form", campaign_ref: "c-1", opening_id: "o-1", full_name: "Ray Driver",
  phone_e164: "+17082365732", email_lower: "ray@example.com", status: "new", assigned_to: null, received_at: "2026-11-03T15:00:00Z",
  answers: { class_a_years: "2to5" }, also: [], drivers: [], do_not_contact: false,
  verdicts: [{ requirement: "class_a_experience", hard: true, verdict: "unknown", evidence: null, detail: { min_years: 2, stated: { lower: 2, upper: 5, upperInclusive: true }, needs: "verification" } }],
  summary: { hardUnmet: 0, unknown: 1, met: 0 },
};
const FAR = { ...ROW, id: "lead-far", full_name: "Far Away", purged_at: null, also: [{ id: "lead-2", channel: "walk_in", status: "lost", received_at: "2026-10-01T15:00:00Z" }], drivers: [{ id: "d-1", status: "applicant", archived: false }] };
const PURGED = { ...ROW, id: "lead-gone", full_name: null, phone_e164: null, email_lower: null, answers: {}, verdicts: [], summary: null, status: "lost", purged_at: "2026-11-01T00:00:00Z" };
const CONTACT = { id: "c1", direction: "outbound", method: "call", outcome: "no_answer", note: "Try after six", note_withheld: false, created_by_name: "Dana Recruiter", contacted_at: "2026-11-03T16:00:00Z" };

/** The drawer's frame teleports out of the mounted tree; what is under test is what it holds. */
const SlideOverStub = { props: ["open", "title"], template: "<div v-if='open' data-test='drawer'><h2>{{ title }}</h2><slot /></div>" };

const ok = (data: unknown) => ({ ok: true, data });
function world(path: string): unknown {
  if (path.endsWith("/lead-far")) return ok(FAR);
  if (path.endsWith("/lead-gone")) return ok(PURGED);
  if (path.endsWith("/lead-far/contacts")) return ok({ contacts: [CONTACT] });
  if (path.endsWith("/lead-gone/contacts")) return ok({ contacts: [{ ...CONTACT, note: null, note_withheld: true }] });
  if (path.includes("/leads?")) return ok({ leads: [ROW], next: null });
  return { ok: false, error: { message: "not stubbed" } };
}

async function render(at: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/recruitment/leads", name: "recruitment-leads", component: { template: "<div />" } },
      { path: "/recruitment/:id", name: "applicant-record", component: { template: "<div />" } },
      { path: "/recruitment", name: "recruitment", component: { template: "<div />" } },
      { path: "/recruitment/screening", name: "screening-readiness", component: { template: "<div />" } },
      { path: "/recruitment/inquiries", name: "inquiry-queue", component: { template: "<div />" } },
      { path: "/recruitment/templates", name: "recruitment-templates", component: { template: "<div />" } },
    ],
  });
  await router.push(at);
  await router.isReady();
  const w = mount(RecruitmentLeadsPage, {
    global: { plugins: [router, [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]], stubs: { PageHeader: { template: "<div />" }, SlideOver: SlideOverStub } },
  });
  for (let i = 0; i < 12; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
  return { w, router };
}

beforeEach(() => {
  setActivePinia(createPinia());
  api.calls = [];
  api.answer = world;
});

describe("the lead queue", () => {
  it("lists a lead with its source, match and status, and links to its drawer", async () => {
    const { w } = await render("/recruitment/leads");
    const text = w.text();
    for (const s of ["Ray Driver", "Meta ad", "1 to check", "New"]) expect(text).toContain(s);
    expect(w.find('a[href*="lead=lead-1"]').exists()).toBe(true);
    expect(api.calls[0]).toBe("/api/recruitment/leads?limit=50");
  });

  it("names a row with no details without claiming they were deleted", async () => {
    api.answer = () => ok({ leads: [{ ...ROW, full_name: null, phone_e164: null, email_lower: null, verdicts: [], summary: null }], next: null });
    const text = (await render("/recruitment/leads")).w.text();
    expect(text).toContain("No details on file");
    expect(text).toContain("Not matched");
    expect(text).not.toContain("deleted");
  });

  it("asks the api for the status the URL names", async () => {
    await render("/recruitment/leads?show=lost");
    expect(api.calls[0]).toBe("/api/recruitment/leads?limit=50&status=lost");
  });

  it("says so when there are no open leads, and when the queue cannot be read", async () => {
    api.answer = () => ok({ leads: [], next: null });
    expect((await render("/recruitment/leads")).w.text()).toContain("No open leads.");
    api.answer = () => ({ ok: false, error: { message: "boom" } });
    expect((await render("/recruitment/leads")).w.text()).toContain("Could not load the leads.");
  });
});

describe("the lead drawer", () => {
  it("opens from a notification's link on a lead the loaded queue does not hold", async () => {
    const { w } = await render("/recruitment/leads?lead=lead-far");
    expect(api.calls).toContain("/api/recruitment/leads/lead-far");
    expect(w.find('[data-test="drawer"] h2').text()).toBe("Far Away");
  });

  it("puts the source beside each field and the why beside each verdict", async () => {
    const { w } = await render("/recruitment/leads?lead=lead-far");
    expect(w.findAll('[data-test="source"]').map((s) => s.text())).toEqual(["Meta ad", "Meta ad", "Meta ad"]);
    expect(w.find('[data-test="answer"]').text()).toContain("2 to 5 years");
    expect(w.find('[data-test="verdict"]').text()).toContain("it counts once an employer or the MVR confirms it");
  });

  it("puts who already called above the answers and verdicts", async () => {
    const { w } = await render("/recruitment/leads?lead=lead-far");
    const html = w.html();
    expect(html.indexOf('data-test="contact"')).toBeLessThan(html.indexOf('data-test="answer"'));
    expect(html.indexOf('data-test="contact"')).toBeLessThan(html.indexOf('data-test="verdict"'));
  });

  it("shows who already made contact, and who else this may be", async () => {
    const { w } = await render("/recruitment/leads?lead=lead-far");
    expect(w.find('[data-test="contact"]').text()).toContain("Dana Recruiter");
    expect(w.find('[data-test="contact"]').text()).toContain("Try after six");
    expect(w.find('[data-test="same-driver"] a').attributes("href")).toBe("/recruitment/d-1");
    expect(w.find('[data-test="same-lead"] a').attributes("href")).toContain("lead=lead-2");
  });

  it("a purged lead shows its tombstone and says a note is withheld, not that there was none", async () => {
    const { w } = await render("/recruitment/leads?lead=lead-gone");
    expect(w.find('[data-test="purged"]').exists()).toBe(true);
    expect(w.find('[data-test="source"]').exists()).toBe(false);
    expect(w.find('[data-test="note-withheld"]').exists()).toBe(true);
  });

  it("closing it takes the lead out of the URL and keeps the filter", async () => {
    const { w, router } = await render("/recruitment/leads?show=lost&lead=lead-far");
    w.findComponent(LeadDrawer).vm.$emit("close");
    await new Promise((r) => setTimeout(r, 0));
    expect(router.currentRoute.value.query).toEqual({ show: "lost" });
  });
});
