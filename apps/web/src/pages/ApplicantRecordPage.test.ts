import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import { createRouter, createMemoryHistory } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { hiringChecklist, APPLICATION_RELEASE_ORDER, type HiringChecklist } from "@silvicom/shared";

/**
 * One applicant's record — the page that holds the checklist and the drawer behind a row (B6).
 *
 * ── WHAT IS ONLY TRUE HERE ────────────────────────────────────────────────────────────────────
 * ⚠ **The open drawer has to follow the fold when the fold changes**, and nothing below the page
 * can be responsible for that: the drawer is handed a step and the panel inside it is handed the
 * state. Measured in a browser on 2026-09-19, filing an MVR from inside the drawer: the list went
 * green, the header count moved, and the drawer went on saying *"Waiting on you"* over the record
 * that had just been filed, with the form still asking for it. The page was storing a COPY of one
 * element of the response — a stored cursor into a refetched list.
 *
 * Both fixtures come from the REAL `hiringChecklist`, so "green" here is the product's own answer.
 */

const base = {
  invitedAt: "2026-09-01T00:00:00Z",
  phases: {
    reviewRequestedAt: "2026-09-02T00:00:00Z",
    approvedAt: "2026-09-03T00:00:00Z",
    submittedAt: null,
  },
  authorizations: APPLICATION_RELEASE_ORDER.map((p) => ({
    id: p, purpose: p, accepted_at: "2026-09-02T00:00:00Z", revokes: null,
  })),
  psp: { requested: false, reportReceived: false },
};

const BEFORE = hiringChecklist({ ...base, qualificationKinds: [] });
const AFTER = hiringChecklist({ ...base, qualificationKinds: ["mvr"] });

/**
 * ⚠ The fold is a REAL `ref` created inside the factory and handed back through this holder, not a
 * plain object wrapped in `ref()` at call time. The page reads `checklistQ.data.value`, so a fresh
 * ref per call — or a ref around a plain holder — is a value the page can never see change, which is
 * precisely the reactivity this file exists to assert.
 */
const fold = vi.hoisted(() => ({ set: null as null | ((c: unknown) => void) }));
vi.mock("@/features/recruitment/useApplicantChecklist", async (importOriginal) => {
  const { ref: mkRef } = await import("vue");
  const data = mkRef<unknown>(null);
  fold.set = (c) => {
    data.value = c;
  };
  return {
    ...(await importOriginal<object>()),
    useApplicantChecklistQuery: () => ({
      data,
      isLoading: mkRef(false),
      isError: mkRef(false),
      isFetching: mkRef(false),
      error: mkRef(null),
      refetch: vi.fn(),
    }),
  };
});

vi.mock("@/features/recruitment/useApplicationInvites", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useApplicationInvitesQuery: () => ({ data: ref([]), isLoading: ref(false), error: ref(null) }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
  DEV_BYPASS: false,
}));

/** The drawer, reduced to the two facts the page is responsible for handing it. */
const DrawerStub = {
  name: "HiringStepDrawer",
  props: ["open", "step", "driverId", "driverStatus", "invitationId"],
  template:
    '<div v-if="open" data-drawer :data-step="step?.key" :data-state="step?.state" />',
};

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/recruitment", name: "recruitment", component: { template: "<div />" } },
    { path: "/recruitment/:id", name: "applicant-record", component: { template: "<div />" } },
    { path: "/drivers/:id", name: "driver-detail", component: { template: "<div />" } },
  ],
});

const mounted: Array<{ unmount: () => void }> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  document.body.innerHTML = "";
});

async function mountPage() {
  setActivePinia(createPinia());
  // ⚠ The page is imported BEFORE the fold is set: importing it is what runs the mock factory that
  // creates the ref, so setting a value first writes through a `fold.set` that is still null.
  const ApplicantRecordPage = (await import("@/pages/ApplicantRecordPage.vue")).default;
  fold.set!(BEFORE);
  await router.push("/recruitment/00000000-0000-4000-8000-0000000000d1");
  await router.isReady();
  const w = mount(ApplicantRecordPage, {
    global: {
      plugins: [router, VueQueryPlugin],
      stubs: {
        HiringStepDrawer: DrawerStub,
        ApplicationReviewDrawer: true,
        DispositionSection: true,
        ExplainerPanel: { template: "<div><slot /></div>" },
      },
    },
    attachTo: document.body,
  });
  mounted.push(w);
  for (let i = 0; i < 5; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
  return w;
}

const settle = async (w: Awaited<ReturnType<typeof mountPage>>) => {
  for (let i = 0; i < 5; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};

describe("the drawer a row opens", () => {
  it("opens on the step that was clicked", async () => {
    const w = await mountPage();
    await w.findAll("button").find((b) => b.text().includes("Driving record"))!.trigger("click");
    await settle(w);
    const drawer = document.body.querySelector("[data-drawer]");
    expect(drawer?.getAttribute("data-step")).toBe("mvr");
    expect(drawer?.getAttribute("data-state")).toBe("waiting_on_us");

    // ⚠ A SECOND row, because a page that opened the same step whatever was clicked passed the
    // assertion above — a mutation pinning the key to `mvr` survived until this line existed.
    await w.findAll("button").find((b) => b.text().includes("Clearinghouse query"))!.trigger("click");
    await settle(w);
    expect(document.body.querySelector("[data-drawer]")?.getAttribute("data-step"))
      .toBe("clearinghouse");
  });

  /**
   * ⚠ **The defect a browser found and no test could.** The refetch that follows recording an act
   * replaces the fold; an open drawer holding a copy of the old row keeps describing it. Asserting
   * through the STATE rather than through the key is what makes this test able to fail: the key is
   * the same in both folds, which is exactly why the stale copy looked right.
   */
  it("follows the fold when the checklist is refetched under it", async () => {
    const w = await mountPage();
    await w.findAll("button").find((b) => b.text().includes("Driving record"))!.trigger("click");
    await settle(w);
    expect(document.body.querySelector("[data-drawer]")?.getAttribute("data-state"))
      .toBe("waiting_on_us");

    // The act is filed elsewhere and the query invalidated: the same step, now green.
    fold.set!(AFTER);
    await settle(w);
    expect(document.body.querySelector("[data-drawer]")?.getAttribute("data-state")).toBe("done");
  });

  /**
   * ⚠ And it closes rather than describing a row the server no longer reports. A fold that stops
   * emitting a step (an evidence table that goes away, a rehire that resets the invitation) must not
   * leave a panel open over nothing.
   */
  it("closes if the fold stops emitting the open step", async () => {
    const w = await mountPage();
    await w.findAll("button").find((b) => b.text().includes("Driving record"))!.trigger("click");
    await settle(w);
    expect(document.body.querySelector("[data-drawer]")).not.toBeNull();

    fold.set!({ ...BEFORE, steps: BEFORE.steps.filter((s) => s.key !== "mvr") });
    await settle(w);
    expect(document.body.querySelector("[data-drawer]")).toBeNull();
  });
});
