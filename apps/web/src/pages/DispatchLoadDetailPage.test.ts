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
// The real wording helpers (they are pure); only the headline is pinned for the facts tests above it.
const headline = vi.hoisted(() => ({ stub: true as boolean }));
vi.mock("@/features/dispatch/useLoadDispatch", async (orig) => {
  const real = (await orig()) as typeof import("@/features/dispatch/useLoadDispatch");
  return { ...real, dispatchHeadline: (d: never) => (headline.stub ? "Not dispatched yet" : real.dispatchHeadline(d)) };
});
const grants = vi.hoisted(() => ({ value: {} as Record<string, boolean> }));
vi.mock("@/stores/session", () => ({
  useSessionStore: () => ({ can: () => false, canView: () => true, hasPermission: (k: string) => grants.value[k] ?? false }),
}));
vi.mock("@/composables/useOrgTimezone", () => ({ useOrgTimezone: () => ({ zone: ref("America/Chicago") }) }));
vi.mock("vue-router", async (orig) => ({
  ...((await orig()) as object),
  useRoute: () => ({ params: { id: "l-1" }, query: {}, meta: {} }),
  useRouter: () => ({ push: vi.fn() }),
}));

// Imported once at the top: a per-test dynamic import counts against each test's 5 s budget.
const Page = (await import("./DispatchLoadDetailPage.vue")).default;
// ChatAboutCard (CH11c) is its own component with its own test (ChatAboutCard.test.ts); here only what
// the page hands it is held.
// LumperOnLoadCard (LUMPER-REVISED-RC-PLAN LRC3) likewise has its own test (LumperOnLoadCard.test.ts).
const stubs = { PageHeader: true, HazmatPanel: true, DispatchLoadDrawer: true, ChatAboutCard: true, LumperOnLoadCard: true, RouterLink: { template: "<a><slot /></a>" } };
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

  it("hands the Chat card the load's id and its reference (CH11c)", async () => {
    setActivePinia(createPinia());
    load.value = tmsLoad();
    const w = mount(Page, { global: { stubs } });
    await flushPromises();
    const card = w.findComponent({ name: "ChatAboutCard" });
    expect(card.exists()).toBe(true);
    expect(card.props()).toMatchObject({ kind: "load", recordId: "l-1", label: "L-1001" });
  });
});

/** LOAD-RATES-PLAN D-RATE8: the Rate block, under the load card, for a `dispatch.load_rates` holder. */
describe("DispatchLoadDetailPage — what the load pays", () => {
  const charges = { total_charge: 4580, linehaul: 4200, other_charges: 380, currency: "USD", billed_miles: 1982, order_loaded_movements: 1 };

  it("shows a holder total, linehaul, other charges and per mile as facts", async () => {
    grants.value = { "dispatch.load_rates": true };
    const [, rate] = await facts({ charges });
    expect(rate).toEqual({ Total: "$4,580.00", Linehaul: "$4,200.00", "Other charges": "$380.00", "Per mile": "$2.31" });
  });

  it("shows nothing to a reader without the switch, and the page's other facts are unmoved", async () => {
    grants.value = {};
    const [, progress] = await facts({ charges });
    expect(progress).not.toHaveProperty("Total");
    expect(progress).toHaveProperty("Created");
  });
});

/** D-MK15 (T1 N-7): a stop McLeod stopped listing stays on the load page, labelled. */
describe("DispatchLoadDetailPage — a stop removed in McLeod", () => {
  const stop = (over: Record<string, unknown>) => ({
    id: "s-1", seq: 1, kind: "pickup", name: "Dock", city: "Howell", state: "MI", appointment_start: null, appointment_end: null,
    required_photos: [], photos: [], status: "pending", mcleod_removed_at: null, ...over,
  });

  it("labels the removed stop, and only that one", async () => {
    setActivePinia(createPinia());
    load.value = tmsLoad({ stops: [stop({}), stop({ id: "s-2", seq: 2, kind: "dropoff", mcleod_removed_at: "2026-11-20T15:00:00Z" })] });
    const w = mount(Page, { global: { stubs } });
    await flushPromises();
    const items = w.findAll("li").filter((li) => li.text().includes("Dock"));
    expect(items).toHaveLength(2);
    expect(items[0]!.find('[data-testid="stop-removed-in-mcleod"]').exists()).toBe(false);
    expect(items[1]!.get('[data-testid="stop-removed-in-mcleod"]').text()).toBe("Removed in McLeod");
  });
});

/** T1 N-9: the dispatch fact says who has seen the load, why nobody can, and when a phone went quiet. */
describe("DispatchLoadDetailPage — the dispatch fact", () => {
  const dispatch = (over: Record<string, unknown> = {}) => ({
    id: "d-1", driverId: "drv-1", driverName: "Dana Reyes", sentAt: "2026-11-27T14:00:00Z", channel: "app", outcome: "sent",
    outcomeReason: null, acknowledgements: [], seats: [{ driverId: "drv-1", driverName: "Dana Reyes" }], reachable: { ok: true },
    seatNote: null, lastContactAt: null, ...over,
  });
  async function dispatchFact(d: Record<string, unknown>, loadOver: Record<string, unknown> = {}) {
    headline.stub = false;
    setActivePinia(createPinia());
    load.value = tmsLoad({ dispatches: [d], ...loadOver });
    const w = mount(Page, { global: { stubs } });
    await flushPromises();
    headline.stub = true;
    return w;
  }

  it("the dispatch fact shows the driver's acknowledgement", async () => {
    const w = await dispatchFact(dispatch({ acknowledgements: [{ driverId: "drv-1", driverName: "Dana Reyes", at: "2026-11-27T15:14:00Z" }] }));
    expect(w.get('[data-testid="dispatch-state"]').text()).toMatch(/· Seen \d{2}\/\d{2}\/2026 \d{1,2}:\d{2} [AP]M$/);
    // Sent through the app: no "no text was sent" line beside it.
    expect(w.find('[data-testid="dispatch-sms-reason"]').exists()).toBe(false);
  });

  it("a silent phone on an active load shows when it last reached us", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-27T17:00:00Z"));
    try {
      const w = await dispatchFact(dispatch({ lastContactAt: "2026-11-27T15:05:00Z" }), { status: "in_transit" });
      expect(w.get('[data-testid="dispatch-phone-silent"]').text()).toMatch(/^Driver's phone last reached us at /);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a dispatch to a driver with no app login says nobody will see it, with the held-text reason", async () => {
    const w = await dispatchFact(
      dispatch({ channel: "sms", outcome: "not_sent", outcomeReason: "sms_not_configured", reachable: { ok: false, reason: "no_app_login" }, seatNote: "mcleod_seats_someone_else" }),
    );
    expect(w.get('[data-testid="dispatch-reach"]').text()).toBe("Not in Dana Reyes's app — no app login");
    expect(w.get('[data-testid="dispatch-seat-note"]').text()).toContain("McLeod has somebody else on this load");
    expect(w.find('[data-testid="dispatch-sms-reason"]').exists()).toBe(true);
  });
});
