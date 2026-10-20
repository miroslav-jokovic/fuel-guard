import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { createPinia } from "pinia";
import { ref } from "vue";

/**
 * D-US5b (2026-10-12) — the roster's form drawers keep Save in the drawer's footer, so it stays on
 * screen however long the form runs. The footer's button sits OUTSIDE the `<form>` and names it with
 * `form="trailer-form"`; this pins that the association really submits the form, through the DOM's own
 * form-owner rule, rather than only that a button with the right attribute exists.
 */
const create = vi.hoisted(() => vi.fn(async () => {}));
// The pages read every unit's file for the File column (UNIT-FILES-PLAN UF4); none is filed here.
vi.mock("@/composables/useOrgTimezone", () => ({ useOrgTimezone: () => ({ zone: ref("America/Chicago"), isResolved: ref(true) }) }));
vi.mock("@/composables/useCompliance", () => ({ useUnitFilesQuery: () => ({ data: ref({ units: [] }) }), useDocumentsQuery: () => ({ data: ref([]) }) }));
vi.mock("@/composables/useTrailerLink", () => ({ useTrailersOnLoadsQuery: () => ({ byTrailerId: { value: new Map() } }) }));
vi.mock("@/composables/useTrailers", () => {
  const idle = () => ({ mutateAsync: vi.fn(), isPending: ref(false) });
  return {
    useTrailersQuery: () => ({ data: ref([]), isLoading: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn(), isFetching: ref(false) }),
    useCreateTrailer: () => ({ mutateAsync: create, isPending: ref(false) }),
    useUpdateTrailer: idle, useRetireTrailer: idle, useBulkUpdateTrailers: idle,
  };
});
vi.mock("@/composables/useVehicles", () => ({ useVehiclesQuery: () => ({ data: ref([]) }) }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true, canView: () => true, canManage: true }) }));
vi.mock("@vueuse/core", async (orig) => ({ ...((await orig()) as object), useMediaQuery: () => ref(true) }));

import TrailersPage from "./TrailersPage.vue";

describe("the roster's form drawer keeps Save in its footer", () => {
  it("submits the trailer form from the footer's Save, which sits outside the form", async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/trailers", component: { template: "<div/>" }, meta: { title: "Trailers" } }] });
    await router.push("/trailers");
    await router.isReady();
    const w = mount(TrailersPage, {
      attachTo: document.body,
      global: { plugins: [router, createPinia()], stubs: { RosterFreshnessLine: true, KebabMenu: true } },
    });
    await flushPromises();
    await w.findAll("button").find((b) => b.text().includes("New trailer"))!.trigger("click");
    await flushPromises();

    const form = document.getElementById("trailer-form") as HTMLFormElement;
    expect(form).toBeTruthy();
    const save = [...document.querySelectorAll<HTMLButtonElement>('button[type="submit"]')].find((b) => b.textContent?.includes("Save trailer"))!;
    expect(save.getAttribute("form")).toBe("trailer-form");
    expect(form.contains(save)).toBe(false);

    const label = [...form.querySelectorAll("label")].find((l) => l.textContent?.includes("Trailer unit number"))!;
    const unit = document.getElementById(label.htmlFor) as HTMLInputElement;
    unit.value = "T-900";
    unit.dispatchEvent(new Event("input"));
    await flushPromises();
    let submitted = 0;
    form.addEventListener("submit", () => (submitted += 1));
    save.click();
    await flushPromises();
    expect(submitted, "the footer button submitted its form").toBe(1);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ unit_number: "T-900" }));
    w.unmount();
  });
});
