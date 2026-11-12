import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";

const who = vi.hoisted(() => ({ full: false }));
const api = vi.hoisted(() => ({ reveal: vi.fn(), replace: vi.fn() }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ hasPermission: () => who.full }) }));
vi.mock("./useApplicationReview", () => ({
  revealApplicantSsn: api.reveal,
  useReplaceApplicantSsn: () => ({ mutateAsync: api.replace, isPending: { value: false } }),
}));
const ApplicantSsnRow = (await import("./ApplicantSsnRow.vue")).default;

/**
 * The SSN on the office's card (Q-AM17). Pinned: everyone sees the last four; only a holder of "See the
 * full SSN" is offered Show, which reads it per press and Hide drops; anyone correcting may Replace,
 * which sends the nine digits and refuses fewer; and nothing is offered once the window has closed.
 */
const mountRow = (props: { last4?: string | null; open?: boolean } = {}) => {
  setActivePinia(createPinia());
  return mount(ApplicantSsnRow, {
    props: { invitationId: "inv-1", last4: props.last4 === undefined ? "6789" : props.last4, open: props.open ?? true },
    global: { plugins: [createPinia(), VueQueryPlugin] },
  });
};
const button = (w: ReturnType<typeof mount>, label: string) => w.findAll("button").find((b) => b.text() === label);

describe("the SSN row", () => {
  beforeEach(() => {
    who.full = false;
    api.reveal.mockReset();
    api.replace.mockReset();
  });

  it("shows the last four to everyone, and no Show without the permission", () => {
    const w = mountRow();
    expect(w.find("[data-ssn-value]").text()).toBe("•••-••-6789");
    expect(button(w, "Show")).toBeUndefined();
  });

  it("reads all nine on Show for a holder, and Hide drops them", async () => {
    who.full = true;
    api.reveal.mockResolvedValue("123456789");
    const w = mountRow();
    await button(w, "Show")!.trigger("click");
    await flushPromises();
    expect(api.reveal).toHaveBeenCalledWith("inv-1");
    expect(w.find("[data-ssn-value]").text()).toBe("123-45-6789");
    await button(w, "Hide")!.trigger("click");
    expect(w.find("[data-ssn-value]").text()).toBe("•••-••-6789");
  });

  it("replaces it with nine digits for anyone correcting, and refuses fewer", async () => {
    api.replace.mockResolvedValue({ last4: "4321" });
    const w = mountRow();
    await button(w, "Replace")!.trigger("click");
    await w.find("#office-ssn").setValue("12345");
    await button(w, "Save")!.trigger("click");
    await flushPromises();
    expect(api.replace).not.toHaveBeenCalled();
    expect(w.text()).toContain("A Social Security number is nine digits.");
    await w.find("#office-ssn").setValue("987-65-4321");
    await button(w, "Save")!.trigger("click");
    await flushPromises();
    expect(api.replace).toHaveBeenCalledWith("987654321");
  });

  it("offers no change once the applicant has started signing, and says when none was given", () => {
    expect(button(mountRow({ open: false }), "Replace")).toBeUndefined();
    const none = mountRow({ last4: null });
    expect(none.find("[data-ssn-value]").text()).toBe("Not given");
    expect(button(none, "Add")).toBeDefined();
  });
});
