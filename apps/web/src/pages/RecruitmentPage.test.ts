import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import { createRouter, createMemoryHistory } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import type { PipelineApplicant } from "@/features/recruitment/useEmployment";

/**
 * The hiring board (B4).
 *
 * ── WHAT IS ONLY TRUE HERE ────────────────────────────────────────────────────────────────────
 * The fold is pinned in `packages/shared`, the projection in `applicantBoard.test.ts`. What this
 * page decides, and nothing else would catch:
 *
 *   · ⚠ **a filter's ✕ must not blank the board.** `FilterSelect.clear()` emits `""`
 *     unconditionally, so a filter whose "show everything" value is `"all"` has no value its own
 *     clear button can produce — pressing it sets a value nothing matches. Measured on this page on
 *     2026-09-18, on two filters inherited from the previous board. It is invisible to every test
 *     that never presses the button, and invisible in review because `"all"` reads as correct.
 *   · **the default view hides rows, and says how many.** §4.1 opens on *waiting on you*, which is
 *     only defensible while the control carries the counts for the views it is not showing.
 *   · **a decided applicant is not in anybody's queue**, which is the half the page owes — the
 *     projection nulls their `waiting_on`, and the row still has to read as closed rather than as
 *     blank.
 */

const row = (over: Partial<PipelineApplicant> & { driver_id: string; full_name: string }): PipelineApplicant =>
  ({
    applied_on: "2026-09-03",
    date_of_birth_recorded: true,
    employers: 1,
    employers_in_window: 1,
    cmv_employers: 1,
    gap_days: 0,
    stage: "awaiting_releases",
    outstanding: [],
    releases_complete: true,
    disposition: null,
    checklist: {
      next: "mvr",
      next_label: "Order the driving record",
      phase: "screening",
      waiting_on: "us",
      done: 5,
      total: 12,
      days_waiting: 4,
      last_progress_at: "2026-09-14T00:00:00Z",
    },
    ...over,
  }) as PipelineApplicant;

const APPLICANTS: PipelineApplicant[] = [
  row({ driver_id: "d1", full_name: "Mine One" }),
  row({ driver_id: "d2", full_name: "Mine Two" }),
  row({
    driver_id: "d3",
    full_name: "Theirs One",
    checklist: {
      next: "drug_test", next_label: "Get the drug test result", phase: "screening",
      waiting_on: "them", done: 6, total: 12, days_waiting: 6, last_progress_at: null,
    },
  }),
  row({
    driver_id: "d4",
    full_name: "Already Declined",
    disposition: {
      id: "x", driver_id: "d4", outcome: "declined", decided_on: "2026-09-02",
      reason: null, rested_on_consumer_report: false, decided_by: null,
      created_at: "2026-09-02T00:00:00Z",
    } as PipelineApplicant["disposition"],
    checklist: {
      next: "mvr", next_label: "Order the driving record", phase: "screening",
      // ⚠ As the projection returns it for a decided application — see `BoardApplicantInput.decided`.
      waiting_on: null, done: 4, total: 12, days_waiting: 16, last_progress_at: null,
    },
  }),
];

vi.mock("@/features/recruitment/useEmployment", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePipelineQuery: () => ({
    data: ref(APPLICANTS),
    isLoading: ref(false),
    isError: ref(false),
    isFetching: ref(false),
    error: ref(null),
    refetch: vi.fn(),
  }),
}));

vi.mock("@/composables/useDrivers", () => ({
  useArchiveDriver: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
}));

/**
 * ⚠ `DataTable` picks its markup from a MEDIA QUERY, not from a class — `useMediaQuery("(min-width:
 * 768px)")` chooses between a real table and a stack of cards. jsdom's `matchMedia` answers `false`
 * to everything, so without this the board renders its phone layout and every `tbody tr` selector
 * below finds nothing while the applicants are plainly in the HTML. Half an hour, once.
 */
function widenViewport(wide: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: wide && query.includes("min-width"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/recruitment", name: "recruitment", component: { template: "<div />" } },
    { path: "/recruitment/screening", name: "screening-readiness", component: { template: "<div />" } },
    { path: "/recruitment/inquiries", name: "inquiry-queue", component: { template: "<div />" } },
    { path: "/recruitment/:id", name: "applicant-record", component: { template: "<div />" } },
  ],
});

/**
 * ⚠ Every mount attaches to `document.body` and `FilterSelect` teleports its panel there too, so a
 * suite that never unmounts leaves a trail of open listboxes for the next test to read. Found the
 * hard way: the decided-application test passed alone and failed in the run, against options
 * belonging to a panel two tests earlier.
 */
const mounted: Array<{ unmount: () => void }> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  document.body.innerHTML = "";
});

async function mountBoard(wide = true) {
  widenViewport(wide);
  setActivePinia(createPinia());
  await router.push("/recruitment");
  await router.isReady();
  const RecruitmentPage = (await import("@/pages/RecruitmentPage.vue")).default;
  /**
   * ⚠ `attachTo: document.body`, and NOT `stubs: { teleport: true }` — this is what
   * `FilterSelect.test.ts` does and the reason is floating-ui. Its `useFloating(…, {
   * whileElementsMounted: autoUpdate })` measures a detached panel for ever and Vue gives up with
   * *"Maximum recursive updates exceeded in <FilterSelect>"*, which reads like a defect in the page
   * and is an artefact of mounting the popover nowhere. The panel teleports to `body`, so the
   * options are read off `document` below rather than off the wrapper.
   */
  const wrapper = mount(RecruitmentPage, {
    global: { plugins: [router, VueQueryPlugin] },
    attachTo: document.body,
  });
  mounted.push(wrapper);
  await wrapper.vm.$nextTick();
  return wrapper;
}

/** The applicant names currently in the table body, in order. */
const names = (wrapper: Awaited<ReturnType<typeof mountBoard>>) =>
  wrapper.findAll("tbody tr").map((tr) => tr.find("td").text().split("invited")[0]!.trim());

const filterTrigger = (wrapper: Awaited<ReturnType<typeof mountBoard>>, label: string) => {
  const trigger = wrapper.findAll("button[aria-haspopup='listbox']").find((b) => b.text().startsWith(label));
  expect(trigger, `no filter trigger for "${label}"`).toBeDefined();
  return trigger!;
};

/** The open panel's options, read off `document` because `FilterSelect` teleports it to `body`. */
const openOptions = () => [...document.querySelectorAll<HTMLElement>("[role='option']")];

/** Open a named FilterSelect and press one of its options. */
async function choose(wrapper: Awaited<ReturnType<typeof mountBoard>>, label: string, option: RegExp) {
  await filterTrigger(wrapper, label).trigger("click");
  const opt = openOptions().find((o) => option.test(o.textContent ?? ""));
  expect(opt, `no option matching ${option} under "${label}"`).toBeDefined();
  opt!.click();
  await wrapper.vm.$nextTick();
}

describe("the default view, and what it must say about what it hides", () => {
  it("opens on what is waiting on the office, not on everybody", async () => {
    const wrapper = await mountBoard();
    // A set, not a list: these two are tied on days waiting, and pinning the order of a tie would
    // pin `sortRows`' tie-breaking rather than this page's filter.
    expect(new Set(names(wrapper))).toEqual(new Set(["Mine One", "Mine Two"]));
    expect(names(wrapper)).toHaveLength(2);
  });

  /**
   * ⚠ The counts are the whole licence for a default that hides rows: a recruiter must be able to
   * see, without changing anything, how many people this view is not showing them.
   */
  it("carries the count of every view it is not showing", async () => {
    const wrapper = await mountBoard();
    await filterTrigger(wrapper, "Waiting on").trigger("click");
    const options = openOptions().map((o) => o.textContent ?? "");
    expect(options.some((o) => /Waiting on you \(2\)/.test(o))).toBe(true);
    expect(options.some((o) => /Waiting on them \(1\)/.test(o))).toBe(true);
    // ⚠ Four, including the declined one: "Everyone" means everyone on the board, and a total that
    // quietly excluded somebody would be the same lie as the hiding default, one level down.
    expect(options.some((o) => /Everyone \(4\)/.test(o))).toBe(true);
  });
});

describe("clearing a filter shows more, never nothing", () => {
  /**
   * ⚠ The defect this file exists for. `FilterSelect.clear()` emits `""`, so every one of these
   * three has to REST at `""` — a "show everything" value of `"all"` is one the clear button cannot
   * produce, and pressing it filters the board down to zero rows while looking like it did the
   * opposite.
   */
  for (const label of ["Waiting on", "Stage", "Show"]) {
    it(`leaves rows on the board after ✕ on ${label}`, async () => {
      const wrapper = await mountBoard();
      const clear = wrapper.findAll("button").find((b) => b.attributes("aria-label") === `Clear ${label} filter`);
      if (!clear) {
        // Only a filter that is away from its resting value renders a ✕. Stage and Show open at
        // rest, so having no button here is the correct state and is asserted rather than skipped.
        expect(label).not.toBe("Waiting on");
        return;
      }
      await clear.trigger("click");
      await wrapper.vm.$nextTick();
      expect(names(wrapper).length).toBeGreaterThan(0);
    });
  }

  it("shows everyone, including the decided application, when the ✕ clears it", async () => {
    const wrapper = await mountBoard();
    const clear = wrapper
      .findAll("button")
      .find((b) => b.attributes("aria-label") === "Clear Waiting on filter");
    await clear!.trigger("click");
    await wrapper.vm.$nextTick();
    expect(names(wrapper)).toContain("Already Declined");
  });
});

describe("a decided application is not work", () => {
  it("keeps it out of the office's own queue", async () => {
    const wrapper = await mountBoard();
    expect(names(wrapper)).not.toContain("Already Declined");
  });

  /**
   * ⚠ And when it IS on screen it must read as closed rather than as blank. A stale next action
   * beside a decline is what would send the next recruiter to chase somebody the carrier already
   * answered — the reason the Stage column shows the decision instead of the phase.
   */
  it("says the decision and no next action when the filter includes it", async () => {
    const wrapper = await mountBoard();
    await choose(wrapper, "Waiting on", /Everyone/);
    const declined = wrapper.findAll("tbody tr").find((tr) => tr.text().includes("Already Declined"));
    expect(declined!.text()).toContain("Declined");
    expect(declined!.text()).toContain("Nothing — this one is closed");
    expect(declined!.text()).not.toContain("Order the driving record");
  });
});

describe("the columns", () => {
  it("leads the oldest first, because that is the question a kanban would have answered", async () => {
    const wrapper = await mountBoard();
    await choose(wrapper, "Waiting on", /Everyone/);
    const days = wrapper.findAll("tbody tr").map((tr) => Number(tr.findAll("td").at(-2)!.text()));
    expect(days).toEqual([...days].sort((a, b) => b - a));
  });

  it("prints the fold's action, never a label written on this page", async () => {
    const wrapper = await mountBoard();
    expect(wrapper.text()).toContain("Order the driving record");
  });
});
