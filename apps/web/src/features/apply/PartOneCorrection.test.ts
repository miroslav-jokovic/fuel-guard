import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { AppCombobox, AppDateField, AppSelect } from "@silvicom/ui";
import type { PartOneFactsView } from "@silvicom/shared";
import PartOneCorrection from "./PartOneCorrection.vue";

/**
 * The office correcting Part 1 (Q-AW36 (a)). Pinned: it opens holding what Part 1 holds, current CDL
 * first; it sends the whole set to this invitation's route in the contract's shape; a licence with no
 * expiry is refused before anything is sent (Q-AW35); a reader gets no button; and nothing about the
 * applicant's own screening answers is offered.
 */

const calls = vi.hoisted(() => ({ list: [] as Array<{ url: string; body: unknown }> }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string, opts?: { body?: unknown }) => {
    calls.list.push({ url, body: opts?.body });
    return { ok: true, data: { ok: true } };
  }),
}));

const role = vi.hoisted(() => ({ value: "recruiter" as string }));
// `can` is the real matrix over the mocked role — the button asks `session.can("recruitment")` (SP5).
vi.mock("@/stores/session", async () => {
  const { canManageSection } = await import("@silvicom/shared");
  return {
    useSessionStore: () => ({
      get role() {
        return role.value;
      },
      can: (s: string) => canManageSection(role.value as never, s as never),
    }),
  };
});

const INVITATION = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const FACTS: PartOneFactsView = {
  intake: {
    phone: "+13125550142", address_line1: "1 Main St", address_line2: null, city: "Joliet", state: "IL",
    postal_code: "60431", prior_positive_2y: false, cdl_class: "A",
  },
  // Out of order on purpose: the form lists the current CDL first whatever order they arrive in.
  licences: [
    { position: 1, state_code: "OH", agency: null, licence_number: "OH-1", expires_on: "2020-01-31" },
    { position: 0, state_code: "IL", agency: null, licence_number: "IL123", expires_on: "2029-03-01" },
  ],
  asOf: "2026-09-27",
};

const mountIt = (facts: PartOneFactsView = FACTS) =>
  mount(PartOneCorrection, {
    props: { invitationId: INVITATION, facts },
    global: { plugins: [VueQueryPlugin] },
  });
const button = (w: ReturnType<typeof mountIt>, label: string) => w.findAll("button").find((b) => b.text() === label);
const input = (w: ReturnType<typeof mountIt>, id: string) => w.find(`#${id}`);

beforeEach(() => {
  setActivePinia(createPinia());
  calls.list.length = 0;
  role.value = "recruiter";
});

describe("the office's Part 1 correction", () => {
  it("opens holding what Part 1 holds, the current CDL first", async () => {
    const w = mountIt();
    await button(w, "Correct these")!.trigger("click");
    expect((input(w, "p1c-phone").element as HTMLInputElement).value).toBe("+13125550142");
    expect((input(w, "p1c-line1").element as HTMLInputElement).value).toBe("1 Main St");
    expect((input(w, "p1c-l0-number").element as HTMLInputElement).value).toBe("IL123");
    expect((input(w, "p1c-l1-number").element as HTMLInputElement).value).toBe("OH-1");
    expect(w.find("[data-licence-row='0']").text()).toContain("Current CDL");
  });

  it("sends the whole set, corrected, to this invitation's route in the contract's shape", async () => {
    const w = mountIt();
    await button(w, "Correct these")!.trigger("click");
    await input(w, "p1c-line1").setValue("12 Depot Rd");
    await input(w, "p1c-l0-number").setValue("IL999");
    await button(w, "Save the correction")!.trigger("click");
    await flushPromises();
    expect(calls.list).toHaveLength(1);
    expect(calls.list[0]!.url).toBe(`/api/recruitment/applications/${INVITATION}/part-one`);
    expect(calls.list[0]!.body).toEqual({
      phone: "+13125550142", address_line1: "12 Depot Rd", address_line2: null, city: "Joliet", state: "IL",
      postal_code: "60431", cdl_class: "A",
      licences: [
        { state_code: "IL", agency: null, licence_number: "IL999", expires_on: "2029-03-01" },
        { state_code: "OH", agency: null, licence_number: "OH-1", expires_on: "2020-01-31" },
      ],
    });
  });

  it("adds and removes an other licence", async () => {
    const w = mountIt();
    await button(w, "Correct these")!.trigger("click");
    await button(w, "Add a licence")!.trigger("click");
    const row = w.find("[data-licence-row='2']");
    expect(row.exists()).toBe(true);
    row.findComponent(AppCombobox).vm.$emit("update:modelValue", "WI");
    await input(w, "p1c-l2-number").setValue("W-1");
    row.findComponent(AppDateField).vm.$emit("update:modelValue", "2019-05-01");
    // The current CDL has no Remove: the list always starts with one.
    expect(w.find("[data-licence-row='0']").text()).not.toContain("Remove");
    await w.findAll("button").filter((b) => b.text() === "Remove this licence")[0]!.trigger("click");
    await button(w, "Save the correction")!.trigger("click");
    await flushPromises();
    const sent = calls.list[0]!.body as { licences: Array<{ licence_number: string }> };
    expect(sent.licences.map((l) => l.licence_number)).toEqual(["IL123", "W-1"]);
  });

  /** Q-AW35: filing refuses a licence without a date, and this is where the office would add one. */
  it("refuses a licence with no expiry date, in the field, and sends nothing", async () => {
    const facts = { ...FACTS, licences: [{ ...FACTS.licences[1]!, expires_on: null }] };
    const w = mountIt(facts);
    await button(w, "Correct these")!.trigger("click");
    await button(w, "Save the correction")!.trigger("click");
    await flushPromises();
    expect(calls.list).toHaveLength(0);
    expect(w.find("[data-licence-row='0']").text()).toContain("Give the expiry date printed on the licence");
  });

  it("names a missing class in its own field", async () => {
    const w = mountIt({ ...FACTS, intake: { ...FACTS.intake, cdl_class: null } });
    await button(w, "Correct these")!.trigger("click");
    await button(w, "Save the correction")!.trigger("click");
    await flushPromises();
    expect(calls.list).toHaveLength(0);
    expect(w.findComponent(AppSelect).exists()).toBe(true);
    expect(w.find("#p1c-class-description").exists()).toBe(true);
  });

  /** The applicant's own statements are theirs (the contract's header). */
  it("offers nothing about the drug and alcohol questions", async () => {
    const w = mountIt();
    await button(w, "Correct these")!.trigger("click");
    expect(w.text()).not.toMatch(/positive|refus|testing program/i);
    expect(w.text()).toContain("Their answers to the drug and alcohol questions are theirs to give.");
  });

  it("gives a reader no button", () => {
    role.value = "auditor";
    expect(button(mountIt(), "Correct these")).toBeUndefined();
  });
});
