import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import RecruitmentTabs from "@/features/recruitment/RecruitmentTabs.vue";

/**
 * The tab strip that replaced two sidebar entries (D-HUI8, B4).
 *
 * ── THIS FILE HOLDS A GUARANTEE THAT USED TO LIVE IN `nav.test.ts` ────────────────────────────
 * ⚠ 2026-08-20 was a P0b incident: `/recruitment/screening` and `/recruitment/inquiries` were
 * registered as routes, had no nav entry, and were reachable only from two buttons on the
 * Applicants page — so a recruiter arriving from a notification had no way back. `nav.test.ts`
 * pinned the fix by asserting all three paths were in the sidebar.
 *
 * B4 takes two of them out of the sidebar, which would have taken that assertion with them. So the
 * guarantee moved here rather than being deleted, and it got stronger on the way: a sidebar entry
 * promised reachability from the sidebar, and this promises it from **every one of the three
 * pages**, including the two a notification links straight into.
 */

/** The four real route records, named exactly as `router/routes/recruitment.ts` names them. */
const routes = [
  { path: "/recruitment", name: "recruitment", component: { template: "<div />" } },
  { path: "/recruitment/screening", name: "screening-readiness", component: { template: "<div />" } },
  { path: "/recruitment/inquiries", name: "inquiry-queue", component: { template: "<div />" } },
  { path: "/recruitment/templates", name: "recruitment-templates", component: { template: "<div />" } },
  { path: "/recruitment/:id", name: "applicant-record", component: { template: "<div />" } },
];

async function mountAt(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(RecruitmentTabs, { global: { plugins: [router] } });
  return { wrapper, router };
}

const tabLabels = (wrapper: { findAll: (s: string) => Array<{ text: () => string }> }) =>
  wrapper.findAll('[role="tab"]').map((t) => t.text());

const selected = (wrapper: {
  findAll: (s: string) => Array<{ text: () => string; attributes: (a: string) => string | undefined }>;
}) => wrapper.findAll('[role="tab"]').find((t) => t.attributes("aria-selected") === "true")?.text();

describe("every recruitment view is reachable from every recruitment page", () => {
  /**
   * ⚠ The P0b guarantee, at its new address. Asserted on all three pages rather than on the board,
   * because the board was never the page somebody got stranded on.
   */
  for (const path of ["/recruitment", "/recruitment/screening", "/recruitment/inquiries", "/recruitment/templates"]) {
    it(`offers all four views from ${path}`, async () => {
      const { wrapper } = await mountAt(path);
      expect(tabLabels(wrapper)).toEqual([
        "Applicants",
        "Screening readiness",
        "Safety-history inquiries",
        "Templates",
      ]);
    });
  }

  it("marks the view you are actually on", async () => {
    expect(selected((await mountAt("/recruitment")).wrapper)).toBe("Applicants");
    expect(selected((await mountAt("/recruitment/screening")).wrapper)).toBe("Screening readiness");
    expect(selected((await mountAt("/recruitment/inquiries")).wrapper)).toBe("Safety-history inquiries");
  });

  /**
   * ⚠ An applicant's own record is a ROW of the first tab, not a fourth view, and `/recruitment/:id`
   * sits under the same prefix as the other two. A path-prefix test would light the wrong tab for an
   * applicant whose id began with the right letters; keying on the route NAME is what avoids it, and
   * this is the case that tells the two implementations apart.
   */
  it("falls back to Applicants on an applicant's own record, and lights no other tab", async () => {
    const { wrapper } = await mountAt("/recruitment/a-driver-id");
    expect(selected(wrapper)).toBe("Applicants");
  });

  it("navigates to the view that was pressed", async () => {
    const { wrapper, router } = await mountAt("/recruitment");
    const inquiries = wrapper.findAll('[role="tab"]')[2];
    expect(inquiries).toBeDefined();
    await inquiries!.trigger("click");
    // ⚠ `router.push` resolves on its own microtask, so the assertion has to wait for the
    // navigation rather than for the click. Without this the test reads the OLD route and passes
    // or fails for a reason that has nothing to do with the component.
    await router.isReady();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(router.currentRoute.value.name).toBe("inquiry-queue");
  });
});
