import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";

/**
 * One load's facts (D-US6): the load card and the progress strip are `FactList`s, so a label sits
 * beside its value, a blank is the list's em dash, and a fact that is only about some loads (the
 * customer, the dispatcher, the dispatch state) is left out rather than shown empty. The failed read
 * has its own case in `pageLoadFailureRetry.test.ts`.
 */
const load = ref<Record<string, unknown>>({});
const tmsLoad = (over: Record<string, unknown> = {}) => ({
  id: "l-1", ref: "L-1001", status: "approved", source: "tms", provider: "McLeod", external_status: null,
  hazmat: false, hazmat_record: null, equipment: "Van", commodity: null, total_miles: null,
  customer_name: "Acme Foods", dispatcher_name: null, driver_name: "Dana Reyes",
  vehicle_unit: "654", trailer_unit: null, external_id: "0123456",
  decline_reason: null, cancel_reason: null, stops: [], events: [], dispatches: [],
  created_at: "2026-10-01T14:00:00Z", submitted_at: null, approved_at: null, released_at: null,
  assigned_at: "2026-10-01T15:00:00Z", accepted_at: null, declined_at: null, completed_at: null,
  ...over,
});

vi.mock("@/features/dispatch/useDispatchLoads", () => ({
  useLoadDetailQuery: () => ({ data: load, isLoading: ref(false), isError: ref(false), error: ref(null), isFetching: ref(false), refetch: vi.fn() }),
}));
vi.mock("@/features/dispatch/useLoadDispatch", () => ({ dispatchHeadline: () => "Not dispatched yet", smsReasonText: () => "" }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => false, canView: () => true }) }));
vi.mock("@/composables/useOrgTimezone", () => ({ useOrgTimezone: () => ({ zone: ref("America/Chicago") }) }));
vi.mock("vue-router", async (orig) => ({
  ...((await orig()) as object),
  useRoute: () => ({ params: { id: "l-1" }, query: {}, meta: {} }),
  useRouter: () => ({ push: vi.fn() }),
}));

// Imported once at the top: a per-test dynamic import counts against each test's 5 s budget.
const Page = (await import("./DispatchLoadDetailPage.vue")).default;
const stubs = { PageHeader: true, HazmatPanel: true, DispatchLoadDrawer: true, RouterLink: { template: "<a><slot /></a>" } };
async function facts(over: Record<string, unknown> = {}) {
  setActivePinia(createPinia());
  load.value = tmsLoad(over);
  const w = mount(Page, { global: { stubs } });
  await flushPromises();
  return w.findAll("dl").map((dl) => Object.fromEntries(dl.findAll("dl > div").map((d) => [d.get("dt").text(), d.get("dd").text()])));
}

describe("DispatchLoadDetailPage — the load's facts", () => {
  it("pairs each fact with its label, and draws a dash for a trailer and dispatcher nobody named", async () => {
    const [card] = await facts();
    expect(card).toEqual({
      Customer: "Acme Foods",
      Dispatcher: "—",
      Driver: "Dana Reyes",
      Truck: "654",
      Trailer: "—",
      "TMS reference": "0123456",
      Dispatch: "Not dispatched yet",
    });
  });

  it("leaves out what is not a fact about this load, and dashes a truck nobody assigned", async () => {
    const [card] = await facts({ source: "manual", customer_name: null, external_id: null, vehicle_unit: null, driver_name: null });
    expect(card).toEqual({ Driver: "Unassigned", Truck: "—", Trailer: "—" });
  });

  it("lists only the stages the load has reached", async () => {
    const [, progress] = await facts();
    expect(Object.keys(progress!)).toEqual(["Created", "Assigned"]);
  });
});
