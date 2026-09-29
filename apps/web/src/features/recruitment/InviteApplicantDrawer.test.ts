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
/**
 * The carrier's link lifetime, read when the drawer mounts (Q-AW41) — kept out of `calls`, which is the
 * log of what the drawer DOES; a read on mount is not an act and would shift every index below.
 */
const settingsReads = vi.hoisted(() => ({ n: 0 }));
const fail = vi.hoisted(() => ({ invite: false }));
/** What the board's duplicate check answers (Q-AX6). Empty by default: nobody is on the board yet. */
const board = vi.hoisted(() => ({ matches: [] as Array<{ id: string; full_name: string; email: string | null; archived: boolean }> }));
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
    if (path === "/api/recruitment/settings") {
      settingsReads.n += 1;
      return { ok: true, data: { settings: { invite_ttl_days: 10, reminders_enabled: true, reminder_after_hours: 48 }, isDefault: false, updatedAt: "2026-09-28T12:00:00Z" } };
    }
    calls.push({ path, init });
    if (path === "/api/roster/drivers") {
      return { ok: true, data: { driver: { id: "d-new", full_name: "Dana Reyes", status: "applicant" } } };
    }
    if (path.startsWith("/api/recruitment/applicant-matches?")) return { ok: true, data: { matches: board.matches } };
    if (path === "/api/recruitment/drivers/d-old/application-invites/again") {
      return { ok: true, data: { link: "https://fuelguard.test/apply/tok-again", delivery: null, mode: "resent" } };
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
    board.matches = [];
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

  /**
   * ⚠ This pins COPY against BEHAVIOUR, which is not normally worth a test — it is here because the
   * two drifted apart and stayed apart. The hint read "The link is not sent from here" while
   * `deliverApplicationInvite` was emailing through Brevo, and the success headline this same
   * component renders has always said "Emailed to …". A recruiter who believed the field was a note
   * to the office would send the link twice or not at all. Corrected 2026-09-14.
   */
  it("tells the recruiter the address is emailed, not merely recorded", () => {
    const w = mountWith("recruiter");
    expect(w.text()).toContain("the link is emailed to this address");
    expect(w.text()).not.toContain("not sent from here");
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

  /**
   * Q-AX6 (C2e): production held four `Marija Varmeda` rows, one per press. The drawer asks the board
   * first and, on a match, creates NOBODY until the office chooses.
   */
  describe("when the person may already be on the board", () => {
    const MATCH = { id: "d-old", full_name: "Dana Reyes", email: "dana@example.test", archived: true };

    it("asks the board by name first, and creates nobody while there is a match", async () => {
      board.matches = [MATCH];
      const w = mountWith("recruiter");
      await fillAndSubmit(w);
      expect(calls[0]!.path).toBe("/api/recruitment/applicant-matches?full_name=Dana+Reyes");
      expect(calls.filter((c) => c.init?.method === "POST")).toEqual([]);
      expect(w.text()).toContain("Already on the applicant board?");
      expect(w.text()).toContain("dana@example.test · archived");
      expect(w.html()).toContain("/recruitment/d-old");
    });

    it("sends the existing record its link again instead of adding a second them", async () => {
      board.matches = [MATCH];
      const w = mountWith("recruiter");
      await fillAndSubmit(w);
      await w.findAll("button").find((b) => b.text() === "Send them the link again")!.trigger("click");
      await settle(w);
      expect(calls.filter((c) => c.init?.method === "POST").map((c) => c.path)).toEqual([
        "/api/recruitment/drivers/d-old/application-invites/again",
      ]);
      expect(w.text()).toContain("https://fuelguard.test/apply/tok-again");
    });

    it("still adds them when the office says it is someone else", async () => {
      board.matches = [MATCH];
      const w = mountWith("recruiter");
      await fillAndSubmit(w);
      await w.findAll("button").find((b) => b.text() === "This is someone else — add them")!.trigger("click");
      await settle(w);
      expect(calls.filter((c) => c.init?.method === "POST").map((c) => c.path)).toEqual([
        "/api/roster/drivers",
        "/api/recruitment/application-invites",
      ]);
    });
  });

  describe("this link's lifetime (Q-AW41)", () => {
    const fill = async (w: ReturnType<typeof mountWith>, days: string) => {
      const inputs = w.findAll("input");
      await inputs[0]!.setValue("Dana");
      await inputs[1]!.setValue("Reyes");
      await inputs[3]!.setValue(days);
    };
    const inviteBody = () =>
      calls.find((c) => c.path === "/api/recruitment/application-invites")!.init!.body as Record<string, unknown>;

    it("shows the carrier's lifetime, and leaves it to the api when left blank", async () => {
      const w = mountWith("recruiter");
      await settle(w);
      expect(settingsReads.n).toBeGreaterThan(0);
      expect(w.findAll("input")[3]!.attributes("placeholder")).toBe("10");
      expect(w.text()).toContain("the carrier's setting, 10 days");
      await fillAndSubmit(w);
      expect(inviteBody()).toEqual({ driver_id: "d-new", email: null });
    });

    it("sends a typed number as this link's override", async () => {
      const w = mountWith("recruiter");
      await settle(w);
      await fill(w, "30");
      await w.findAll("button").find((b) => b.text() === "Add and create the link")!.trigger("click");
      await settle(w);
      expect(inviteBody()).toEqual({ driver_id: "d-new", email: null, expires_in_days: 30 });
    });

    it("refuses a lifetime outside 1 to 60 days, and sends nothing", async () => {
      for (const bad of ["0", "61", "2.5"]) {
        calls.length = 0;
        const w = mountWith("recruiter");
        await settle(w);
        await fill(w, bad);
        const submit = w.findAll("button").find((b) => b.text() === "Add and create the link")!;
        expect(submit.attributes("disabled"), bad).toBeDefined();
        expect(w.text()).toContain("Between 1 and 60 days.");
        w.unmount();
      }
      expect(calls).toHaveLength(0);
    });

    it("refuses a link that dies before its driver counts as stopped, before adding anybody (Q-AW51)", async () => {
      const w = mountWith("recruiter");
      await settle(w);
      calls.length = 0;
      await fill(w, "2");
      const submit = w.findAll("button").find((b) => b.text() === "Add and create the link")!;
      expect(submit.attributes("disabled")).toBeDefined();
      expect(w.text()).toContain("At least 3 days: a driver counts as stopped after 48 hours");
      await submit.trigger("click");
      await settle(w);
      // Nothing at all — not the applicant either, who would otherwise be left without a link.
      expect(calls.filter((c) => c.init?.method === "POST")).toHaveLength(0);
      await fill(w, "3");
      await settle(w);
      expect(w.findAll("button").find((b) => b.text() === "Add and create the link")!.attributes("disabled")).toBeUndefined();
    });
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
