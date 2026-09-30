import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import ApplicationInviteCard from "@/features/recruitment/ApplicationInviteCard.vue";

/**
 * One link at a time (C2e: Q-AX5, Q-AX6). While the applicant's current invitation can still be used,
 * the card offers "Send the link again" and never "Create an application link" — a second invitation
 * opens a second, empty application beside the one they have been filling in. A revoked or finished
 * one gets the create form back: a fresh application (owner, 2026-09-27).
 */
const calls: Array<{ path: string; method?: string }> = [];
const state = vi.hoisted(() => ({ invitations: [] as Array<Record<string, unknown>> }));

vi.mock("@/stores/session", async () => {
  const { canManageSection } = await import("@silvicom/shared");
  return { useSessionStore: () => ({ role: "recruiter", can: (s: string) => canManageSection("recruiter", s as never) }) };
});
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string, init?: { method?: string }) => {
    calls.push({ path, method: init?.method });
    if (path.endsWith("/application-invites")) return { ok: true, data: { invitations: state.invitations } };
    if (path.endsWith("/application-invites/again")) {
      return { ok: true, data: { link: "https://fuelguard.test/apply/tok-again", delivery: null, mode: "resent" } };
    }
    if (path.endsWith("/application")) return { ok: true, data: { application: null, documentUrl: null } };
    return { ok: true, data: {} };
  }),
}));

const invitation = (over: Record<string, unknown> = {}) => ({
  id: "inv-1", driver_id: "d-1", email: "dana@example.test", expires_at: "2026-09-01T00:00:00Z",
  consented_at: null, releases_completed_at: null, review_requested_at: null, approved_at: null,
  submitted_at: null, handbook_filed_at: null, revoked_at: null, created_at: "2026-08-20T00:00:00Z", has_draft: true, ...over,
});

const settle = async (w: ReturnType<typeof mount>) => {
  for (let i = 0; i < 10; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};

const render = async () => {
  const w = mount(ApplicationInviteCard, {
    props: { driverId: "d-1", driverStatus: "applicant" },
    global: { plugins: [VueQueryPlugin], stubs: { DataTable: true } },
  });
  await settle(w);
  return w;
};
const buttons = (w: ReturnType<typeof mount>) => w.findAll("button").map((b) => b.text());

beforeEach(() => {
  setActivePinia(createPinia());
  calls.length = 0;
  state.invitations = [];
});

describe("the application link on an applicant's record", () => {
  it("offers to send an expired link again, not a second application", async () => {
    state.invitations = [invitation()];
    const w = await render();
    expect(buttons(w)).toContain("Send the link again");
    expect(buttons(w)).not.toContain("Create an application link");
    expect(w.text()).toContain("It is emailed to dana@example.test.");

    await w.findAll("button").find((b) => b.text() === "Send the link again")!.trigger("click");
    await settle(w);
    expect(calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual([
      "/api/recruitment/drivers/d-1/application-invites/again",
    ]);
    expect(w.text()).toContain("https://fuelguard.test/apply/tok-again");
  });

  /** D-AW1: a filed application's link still carries the handbook. */
  it("offers it for a filed application whose handbook is still to come", async () => {
    state.invitations = [invitation({ submitted_at: "2026-09-14T00:00:00Z" })];
    expect(buttons(await render())).toContain("Send the link again");
  });

  it("offers a new application when the current one is revoked or finished, or there is none", async () => {
    for (const rows of [
      [invitation({ revoked_at: "2026-09-02T00:00:00Z" })],
      [invitation({ handbook_filed_at: "2026-09-20T00:00:00Z" })],
      [],
    ]) {
      state.invitations = rows;
      const w = await render();
      expect(buttons(w)).toContain("Create an application link");
      expect(buttons(w)).not.toContain("Send the link again");
      w.unmount();
    }
  });
});
