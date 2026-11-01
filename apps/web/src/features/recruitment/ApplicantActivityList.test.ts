import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import ApplicantActivityList from "@/features/recruitment/ApplicantActivityList.vue";
import { lastNoteLine } from "@/features/recruitment/useApplicantNotes";

/**
 * The applicant's activity (§9 P10): the server's dated list, printed in its order with
 * `formatDisplayDateTime`, an office correction named by the function the page passes in.
 */
const state = vi.hoisted(() => ({ activity: [] as unknown[] }));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(async () => ({ ok: true, data: { activity: state.activity } })) }));

const settle = async (w: ReturnType<typeof mount>) => {
  for (let i = 0; i < 10; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};

beforeEach(() => {
  setActivePinia(createPinia());
  state.activity = [
    { at: "2026-10-05T15:00:00Z", kind: "answer_edited", text: "Changed an answer", actor: "Dana", edit: { path: ["employers", "k", "address_line1"], change: "filled", employer: "ABC Trucking" } },
    { at: "2026-10-02T15:00:00Z", kind: "permission_signed", text: "Signed permission: PSP", actor: null },
    { at: "2026-10-01T15:00:00Z", kind: "invited", text: "Invited to apply", actor: "Dana" },
  ];
});

describe("ApplicantActivityList", () => {
  it("prints each item with its date and time, in the server's newest-first order", async () => {
    const describeEdit = vi.fn(() => "filled in “Street address” for ABC Trucking");
    const w = mount(ApplicantActivityList, { props: { driverId: "d1", describeEdit }, global: { plugins: [VueQueryPlugin] } });
    await settle(w);
    const rows = w.findAll('[data-test="activity"]').map((r) => r.text());
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("Dana filled in “Street address” for ABC Trucking");
    expect(rows[0]).toMatch(/10\/05\/2026 \d{1,2}:\d{2} (AM|PM)/);
    expect(rows[1]).toContain("Signed permission: PSP");
    expect(rows[2]).toContain("Invited to apply — Dana");
    expect(describeEdit).toHaveBeenCalledWith(expect.objectContaining({ employer: "ABC Trucking", change: "filled" }));
  });

  it("says so when nothing has happened", async () => {
    state.activity = [];
    const w = mount(ApplicantActivityList, { props: { driverId: "d1", describeEdit: () => "" }, global: { plugins: [VueQueryPlugin] } });
    await settle(w);
    expect(w.text()).toContain("Nothing has happened yet.");
  });
});

describe("lastNoteLine", () => {
  it("says the board's line in whole days, today for this morning", () => {
    const now = new Date("2026-11-01T18:00:00Z");
    expect(lastNoteLine({ created_at: "2026-10-30T06:00:00Z", author_name: "Dana" }, now)).toBe("Last note: 2 d ago · Dana");
    expect(lastNoteLine({ created_at: "2026-11-01T08:00:00Z", author_name: "Dana" }, now)).toBe("Last note: today · Dana");
  });
});
