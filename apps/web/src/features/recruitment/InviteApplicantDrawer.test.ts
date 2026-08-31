import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import InviteApplicantDrawer from "@/features/recruitment/InviteApplicantDrawer.vue";

/**
 * The front door (U1, D-UI1).
 *
 * What is pinned here is the halfway state, because it is the only part of this drawer that cannot
 * be seen by using it: the applicant is created by one call and invited by a second, and if the
 * second fails the person EXISTS on the board with no link. A drawer that reported "could not
 * invite" would leave them there unexplained. Everything else — the two calls, the status that puts
 * somebody on the board at all, the once-only link — is pinned because a silent change to any of
 * them makes an applicant who never appears or a link that is quietly re-shown.
 */
const calls: Array<{ path: string; init?: { method?: string; body?: unknown } }> = [];
const fail = vi.hoisted(() => ({ invite: false }));
const role = vi.hoisted(() => ({ value: "recruiter" as string | null }));

/**
 * ⚠ `session.role` is a COMPUTED over the decoded access token, so assigning it does nothing and a
 * gating test written that way passes for the wrong reason — both of this file's gate assertions did,
 * until the two calls they were supposed to prove never fired. The store is stubbed instead, which is
 * `PspRecordsSection.test.ts:103`'s precedent in this same folder.
 */
vi.mock("@/stores/session", () => ({
  useSessionStore: () => ({ get role() { return role.value; } }),
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string, init?: { method?: string; body?: unknown }) => {
    calls.push({ path, init });
    if (path === "/api/roster/drivers") {
      return { ok: true, data: { driver: { id: "d-new", full_name: "Dana Reyes", status: "applicant" } } };
    }
    if (path === "/api/recruitment/application-invites") {
      if (fail.invite) return { ok: false, error: { message: "Invitation service is down" } };
      return { ok: true, data: { link: "https://fuelguard.test/apply/tok-123" } };
    }
    return { ok: true, data: {} };
  }),
}));

const SlideOverStub = {
  template: "<div><slot /><slot name='footer' /></div>",
  props: ["open", "title", "size", "description"],
};

/** The recovery affordance is a real link, so an unstubbed RouterLink throws during setup and takes
 *  the whole panel down with it — which is how the halfway-state assertion first failed. */
const RouterLinkStub = { template: "<a :href='to'><slot /></a>", props: ["to"] };

const mountWith = (as: string) => {
  role.value = as;
  return mount(InviteApplicantDrawer, {
    props: { open: true },
    global: { plugins: [VueQueryPlugin], stubs: { SlideOver: SlideOverStub, RouterLink: RouterLinkStub, teleport: true } },
  });
};

const settle = async (w: ReturnType<typeof mountWith>) => {
  for (let i = 0; i < 10; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};

const fillAndSubmit = async (w: ReturnType<typeof mountWith>) => {
  const inputs = w.findAll("input");
  await inputs[0]!.setValue("Dana");
  await inputs[1]!.setValue("Reyes");
  await w.findAll("button").find((b) => b.text() === "Add and create the link")!.trigger("click");
  await settle(w);
};

describe("inviting an applicant from the board", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    calls.length = 0;
    fail.invite = false;
    role.value = "recruiter";
  });

  /** `status: "applicant"` is what the pipeline selects on — without it this creates a driver on
   *  the roster and an applicant nowhere. */
  it("creates the person as an applicant, then mints the invitation against them", async () => {
    const w = mountWith("recruiter");
    await fillAndSubmit(w);

    const posts = calls.filter((c) => c.init?.method === "POST");
    expect(posts.map((p) => p.path)).toEqual([
      "/api/roster/drivers",
      "/api/recruitment/application-invites",
    ]);
    expect(posts[0]!.init?.body).toEqual({
      first_name: "Dana",
      last_name: "Reyes",
      email: null,
      status: "applicant",
    });
    expect(posts[1]!.init?.body).toEqual({ driver_id: "d-new", email: null });
  });

  it("shows the link once, and says it cannot be shown again", async () => {
    const w = mountWith("recruiter");
    await fillAndSubmit(w);
    expect(w.text()).toContain("https://fuelguard.test/apply/tok-123");
    expect(w.text()).toContain("It is shown once");
  });

  /** The one state a person cannot discover by using the drawer. */
  it("when the invitation fails, says the applicant exists and where to finish", async () => {
    fail.invite = true;
    const w = mountWith("recruiter");
    await fillAndSubmit(w);

    expect(w.text()).toContain("Dana Reyes is on the applicant board");
    // R7 moved the applicant record onto the recruitment surface. The OLD destination still
    // resolves and redirects here, so nobody's bookmark broke — but a recovery button this drawer
    // ships should point at where the work is, not at a redirect.
    expect(w.html()).toContain("/recruitment/d-new");
    expect(w.text()).not.toContain("It is shown once");
  });

  it("refuses to submit without both names", async () => {
    const w = mountWith("recruiter");
    await w.findAll("input")[0]!.setValue("Dana");
    const submit = w.findAll("button").find((b) => b.text() === "Add and create the link")!;
    expect(submit.attributes("disabled")).toBeDefined();
    expect(calls).toHaveLength(0);
  });

  it("offers nothing to a role that may read the board but not add to it", async () => {
    const w = mountWith("dispatcher");
    await settle(w);
    expect(w.text()).toContain("Your role can read the applicant board but not add to it");
    const submit = w.findAll("button").find((b) => b.text() === "Add and create the link");
    expect(submit?.attributes("disabled")).toBeDefined();
  });
});
