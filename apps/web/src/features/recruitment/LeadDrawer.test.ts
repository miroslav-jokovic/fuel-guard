import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { sectionAccess, type LeadRecord } from "@silvicom/shared";
import { useToastStore } from "@/stores/toast";
import LeadDrawer from "./LeadDrawer.vue";

/**
 * Working a lead (E4b3) over a stubbed `apiFetch`: who sees the buttons, what each act sends, and what a refusal
 * or a held number says. Reads and how they look are `RecruitmentLeadsPage.test.ts`'s.
 */
const api = vi.hoisted(() => ({
  writes: [] as Array<{ path: string; method: string; body: unknown }>,
  answer: null as null | ((path: string, method: string) => unknown),
  held: null as null | Promise<void>,
}));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string, init?: { method?: string; body?: unknown }) => {
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      api.writes.push({ path, method, body: init?.body });
      if (api.held) await api.held;
    }
    return api.answer!(path, method);
  }),
}));
const session = vi.hoisted(() => ({ role: "recruiter" as string, can: (_s: string): boolean => true }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => session }));

const LEAD: LeadRecord = {
  id: "lead-1", channel: "meta", source: "instant_form", campaign_ref: null, opening_id: null, full_name: "Ray Driver",
  phone_e164: "+17082365732", email_lower: null, status: "new", assigned_to: null, received_at: "2026-11-03T15:00:00Z",
  answers: {}, also: [], drivers: [], verdicts: [], summary: null, do_not_contact: false, purged_at: null,
};
const ok = (data: unknown) => ({ ok: true, data });
const refused = (message: string) => ({ ok: false, error: { code: "x", message } });

const SlideOverStub = { props: ["open", "title"], template: "<div v-if='open'><slot /><footer><slot name='footer' /></footer></div>" };

async function render(lead = LEAD, write: (path: string, method: string) => unknown = () => ok({})) {
  api.answer = (path, method) => {
    if (method !== "GET") return write(path, method);
    return path.endsWith("/contacts") ? ok({ contacts: [] }) : ok(lead);
  };
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { template: "<div />" } }] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidated = vi.spyOn(queryClient, "invalidateQueries");
  const w = mount(LeadDrawer, {
    props: { leadId: lead.id },
    global: { plugins: [router, [VueQueryPlugin, { queryClient }]], stubs: { SlideOver: SlideOverStub } },
  });
  await settle();
  return { w, router, invalidated };
}
async function settle() {
  for (let i = 0; i < 6; i++) {
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
  }
}
const toasts = () => useToastStore().toasts.map((t) => `${t.title}: ${t.message ?? ""}`);
const has = (w: Awaited<ReturnType<typeof render>>["w"], test: string) => w.find(`[data-test="${test}"]`).exists();

beforeEach(() => {
  setActivePinia(createPinia());
  api.writes = [];
  api.held = null;
  session.role = "recruiter";
  session.can = () => true;
});

describe("who can work a lead", () => {
  it("a role that manages recruitment sees the three acts", async () => {
    const { w } = await render();
    for (const b of ["hold", "convert", "log-contact"]) expect(has(w, b)).toBe(true);
  });

  it("a view-only role sees none, from the shared matrix", async () => {
    expect(sectionAccess("auditor", "recruitment")).toBe("view");
    session.can = (s) => sectionAccess("auditor", s as never) === "manage";
    const { w } = await render();
    for (const b of ["hold", "convert", "log-contact"]) expect(has(w, b)).toBe(false);
  });

  it("a purged lead shows none, even to a manager", async () => {
    const { w } = await render({ ...LEAD, full_name: null, phone_e164: null, purged_at: "2026-11-01T00:00:00Z" });
    for (const b of ["hold", "convert", "log-contact"]) expect(has(w, b)).toBe(false);
  });

  it("a lead already an applicant cannot be converted again", async () => {
    const { w } = await render({ ...LEAD, status: "converted" });
    expect(has(w, "convert")).toBe(false);
    expect(has(w, "log-contact")).toBe(true);
  });
});

describe("logging a contact", () => {
  it("sends what was filled in, with no outcome unless one was chosen, and goes back to the lead", async () => {
    const { w, invalidated } = await render();
    await w.find('[data-test="log-contact"]').trigger("click");
    await w.find('[data-test="method"]').setValue("sms");
    await w.find('[data-test="note"]').setValue("  Call after six  ");
    await w.find('[data-test="contact-form"]').trigger("submit");
    await settle();
    expect(api.writes).toEqual([{
      path: "/api/recruitment/leads/lead-1/contacts", method: "POST",
      body: { direction: "outbound", method: "sms", outcome: null, note: "Call after six" },
    }]);
    expect(has(w, "contact-form")).toBe(false);
    expect(toasts()[0]).toContain("Contact logged");
    expect(invalidated).toHaveBeenCalledWith({ queryKey: ["recruitment", "leads"] });
  });

  it("a double press writes one row, and the button is disabled in flight", async () => {
    let release = () => {};
    api.held = new Promise((r) => (release = r));
    const { w } = await render();
    await w.find('[data-test="log-contact"]').trigger("click");
    const form = w.find('[data-test="contact-form"]');
    await Promise.all([form.trigger("submit"), form.trigger("submit")]);
    await form.trigger("submit");
    expect(api.writes).toHaveLength(1);
    expect(w.find('[data-test="save-contact"]').attributes("disabled")).toBeDefined();
    release();
    await settle();
  });

  it("a refusal keeps what was typed and says the api's sentence", async () => {
    const { w } = await render(LEAD, () => refused("This lead's details were deleted, so nothing more can be recorded on it."));
    await w.find('[data-test="log-contact"]').trigger("click");
    await w.find('[data-test="contact-form"]').trigger("submit");
    await settle();
    expect(has(w, "contact-form")).toBe(true);
    expect(toasts()[0]).toContain("This lead's details were deleted");
  });
});

describe("making an applicant", () => {
  const MADE = { conversion_id: "cv", driver_id: "d-9", created_applicant: true };

  it("with no match creates one, refreshes the board, and links to the new applicant", async () => {
    const { w, router, invalidated } = await render(LEAD, () => ok(MADE));
    await w.find('[data-test="convert"]').trigger("click");
    await w.find('[data-test="save-convert"]').trigger("click");
    await settle();
    expect(api.writes[0]).toMatchObject({ path: "/api/recruitment/leads/lead-1/convert", body: { driver_id: null } });
    for (const queryKey of [["recruitment", "leads"], ["recruitment", "pipeline"], ["drivers"]]) expect(invalidated).toHaveBeenCalledWith({ queryKey });
    const toast = useToastStore().toasts[0]!;
    expect(toast.title).toBe("Applicant created");
    await toast.action!.onAction();
    await settle();
    expect(router.currentRoute.value.path).toBe("/recruitment/d-9");
  });

  it("with a match makes the recruiter choose, offers only open applicants, and attaches to the one chosen", async () => {
    const drivers = [{ id: "d-open", status: "applicant", archived: false }, { id: "d-old", status: "applicant", archived: true }, { id: "d-hired", status: "active", archived: false }];
    const { w } = await render({ ...LEAD, drivers }, () => ok({ ...MADE, driver_id: "d-open", created_applicant: false }));
    await w.find('[data-test="convert"]').trigger("click");
    expect(w.find('[data-test="save-convert"]').attributes("disabled")).toBeDefined();
    expect(w.findAll('input[type="radio"]')).toHaveLength(2);
    expect(has(w, "other-records")).toBe(true);
    await w.findAll('input[type="radio"]')[0]!.setValue();
    await w.find('[data-test="save-convert"]').trigger("click");
    await settle();
    expect(api.writes[0]!.body).toEqual({ driver_id: "d-open" });
    expect(useToastStore().toasts[0]!.title).toBe("Added to their record");
  });

  it.each([
    "This lead is already being made an applicant. Refresh in a moment.",
    "This lead is already an applicant.",
    "That person is not an open applicant of this carrier.",
    "Add the person's name before making them an applicant.",
  ])("shows the api's sentence: %s", async (sentence) => {
    const { w } = await render(LEAD, () => refused(sentence));
    await w.find('[data-test="convert"]').trigger("click");
    await w.find('[data-test="save-convert"]').trigger("click");
    await settle();
    expect(toasts()[0]).toContain(sentence);
  });
});

describe("do not contact", () => {
  const press = async (w: Awaited<ReturnType<typeof render>>["w"]) => {
    await w.find('[data-test="hold"]').trigger("click");
    await w.find('[data-test="save-hold"]').trigger("click");
    await settle();
  };

  it("asks in the drawer's own body, and cancelling writes nothing", async () => {
    const { w } = await render();
    await w.find('[data-test="hold"]').trigger("click");
    expect(has(w, "hold-form")).toBe(true);
    await w.findAll("button").find((b) => b.text() === "Cancel")!.trigger("click");
    expect(has(w, "hold-form")).toBe(false);
    expect(api.writes).toEqual([]);
  });

  it("holds with a POST", async () => {
    const { w } = await render(LEAD, () => ok({ kind: "held", newly: true, applicant_id: null }));
    await press(w);
    expect(api.writes[0]).toMatchObject({ path: "/api/recruitment/leads/lead-1/do-not-contact", method: "POST" });
    expect(toasts()[0]).toContain("Marked do not contact");
  });

  it("a lead with no phone is refused in the api's words", async () => {
    const { w } = await render({ ...LEAD, phone_e164: null }, () => refused("This lead has no phone number to hold."));
    await press(w);
    expect(toasts()[0]).toContain("no phone number");
  });

  it("lifts with a DELETE", async () => {
    const { w } = await render({ ...LEAD, do_not_contact: true }, () => ok({ kind: "lifted", lifted: 1, stop_remains: false }));
    expect(w.find('[data-test="hold"]').text()).toBe("Lift do not contact");
    await press(w);
    expect(api.writes[0]!.method).toBe("DELETE");
    expect(toasts()[0]).toContain("Hold lifted");
  });

  it.each([1, 0])("never says lifted while a STOP stands (office holds lifted: %i)", async (lifted) => {
    const { w } = await render({ ...LEAD, do_not_contact: true }, () => ok({ kind: "lifted", lifted, stop_remains: true }));
    await press(w);
    const toast = useToastStore().toasts[0]!;
    expect(toast.variant).toBe("warning");
    expect(toast.title).toBe("The number stays held");
    expect(toast.message).toContain("texted STOP");
  });
});

describe("deleting details", () => {
  const OTHER = { id: "lead-2", channel: "walk_in", status: "lost" as const, received_at: "2026-10-01T15:00:00Z" };
  const GONE = { purged: ["lead-1"], already: [], skipped_applicants: [] };
  const open = async (w: Awaited<ReturnType<typeof render>>["w"]) => {
    await w.find('[data-test="purge"]').trigger("click");
    await settle();
  };

  it("shows for an admin and no other role, whatever they manage", async () => {
    expect(has((await render()).w, "purge")).toBe(false);
    session.role = "admin";
    expect(has((await render()).w, "purge")).toBe(true);
    expect(has((await render({ ...LEAD, purged_at: "2026-11-01T00:00:00Z" })).w, "purge")).toBe(false);
  });

  it("says what it does, offers the person's other leads only when there are some, and sends the choice", async () => {
    session.role = "admin";
    const { w, invalidated } = await render({ ...LEAD, also: [OTHER] }, () => ok({ ...GONE, purged: ["lead-1", "lead-2"] }));
    await open(w);
    expect(w.find('[data-test="purge-form"]').text()).toContain("can't be undone");
    await w.find('input[type="checkbox"]').setValue(true);
    await w.find('[data-test="save-purge"]').trigger("click");
    await settle();
    expect(api.writes).toEqual([{ path: "/api/recruitment/leads/lead-1/purge", method: "POST", body: { same_person: true } }]);
    expect(toasts()[0]).toContain("2 leads were emptied");
    expect(invalidated).toHaveBeenCalledWith({ queryKey: ["recruitment", "leads"] });

    const alone = (await render()).w;
    await open(alone);
    expect(alone.find('input[type="checkbox"]').exists()).toBe(false);
  });

  it("asks for the password, and the same delete runs once it is given", async () => {
    session.role = "admin";
    let fresh = false;
    const { w } = await render(LEAD, () => (fresh ? ok(GONE) : { ok: false, error: { code: "step_up_required", message: "Confirm your password." } }));
    await open(w);
    await w.find('[data-test="save-purge"]').trigger("click");
    await settle();
    expect(w.text()).toContain("Confirm your password.");
    expect(has(w, "save-purge")).toBe(false);
    expect(toasts()).toEqual([]);
    fresh = true;
    w.findComponent({ name: "StepUpPrompt" }).vm.$emit("confirmed");
    await settle();
    expect(api.writes).toHaveLength(2);
    expect(toasts()[0]).toContain("Details deleted");
  });

  it("cancelling the password prompt deletes nothing and does not retry later", async () => {
    session.role = "admin";
    const { w } = await render(LEAD, () => ({ ok: false, error: { code: "step_up_required", message: "Confirm your password." } }));
    await open(w);
    await w.find('[data-test="save-purge"]').trigger("click");
    await settle();
    w.findComponent({ name: "StepUpPrompt" }).vm.$emit("cancel");
    await settle();
    expect(api.writes).toHaveLength(1);
    expect(has(w, "save-purge")).toBe(true);
  });

  it("names a lead left behind because it became an applicant", async () => {
    session.role = "admin";
    const { w } = await render(LEAD, () => ok({ ...GONE, skipped_applicants: ["lead-2"] }));
    await open(w);
    await w.find('[data-test="save-purge"]').trigger("click");
    await settle();
    expect(useToastStore().toasts[0]!.variant).toBe("warning");
    expect(toasts()[0]).toContain("1 other lead became an applicant");
  });

  it("says became_applicant in the api's words", async () => {
    session.role = "admin";
    const sentence = "This lead became an applicant. Delete the applicant instead; that removes the lead with them.";
    const { w } = await render({ ...LEAD, status: "converted" }, () => ({ ok: false, error: { code: "became_applicant", message: sentence } }));
    await open(w);
    await w.find('[data-test="save-purge"]').trigger("click");
    await settle();
    expect(toasts()[0]).toContain(sentence);
  });
});
