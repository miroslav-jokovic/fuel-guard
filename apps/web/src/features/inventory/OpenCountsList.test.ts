import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import type { CountSessionDto } from "@silvicom/shared";

/**
 * The open walks (R9, DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md §5). Production held four open checks of
 * one truck that no screen listed. What only this component decides:
 *
 *   · **it asks for the OPEN walks of the unit it is given** — the unit page must not list another
 *     truck's check, and the home must not list closed ones;
 *   · **Close asks first, then closes that walk** — closing cannot be undone;
 *   · **a viewer sees the list without Continue or Close**, both of which write;
 *   · **a failed read is a Retry, not "nothing open"**, which would hide the walks it exists to show.
 */

const walk = (over: Partial<CountSessionDto> = {}): CountSessionDto => ({
  id: "11111111-1111-4111-8111-111111111111",
  kind: "unit",
  locationId: null,
  vehicleId: "22222222-2222-4222-8222-222222222222",
  trailerId: null,
  holderLabel: "654",
  startedBy: null,
  startedByName: "Shop Lead",
  blind: false,
  status: "open",
  openedAt: "2026-10-19T14:00:00.000Z",
  closedAt: null,
  note: null,
  ...over,
});

const state = {
  sessions: [] as CountSessionDto[],
  failed: false,
  manage: true,
  confirm: vi.fn(async () => true),
  close: vi.fn(async () => ({})),
  refetch: vi.fn(),
  filter: null as { value: Record<string, unknown> } | null,
  pushed: [] as unknown[],
};

vi.mock("@/features/inventory/useInventory", () => ({
  useCountSessionsQuery: (f: { value: Record<string, unknown> }) => {
    state.filter = f;
    return {
      data: ref(state.failed ? undefined : { sessions: state.sessions, total: state.sessions.length }),
      isError: ref(state.failed),
      isFetching: ref(false),
      refetch: state.refetch,
    };
  },
  useCloseCountSession: () => ({ mutateAsync: state.close, isPending: ref(false) }),
}));
vi.mock("@silvicom/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@silvicom/ui")>()),
  useConfirm: () => state.confirm,
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => state.manage }) }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: (to: unknown) => state.pushed.push(to) }) }));
// The desktop table: jsdom has no `matchMedia`, and DataTable would otherwise draw its narrow cards.
vi.mock("@vueuse/core", async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  useMediaQuery: () => ref(true),
}));

const OpenCountsList = (await import("./OpenCountsList.vue")).default;
const render = (props: Record<string, unknown> = {}) => mount(OpenCountsList, { props: { title: "Open check", ...props } });
const button = (w: ReturnType<typeof render>, text: string) => w.findAll("button").find((b) => b.text() === text);

beforeEach(() => {
  Object.assign(state, { sessions: [], failed: false, manage: true, filter: null, pushed: [] });
  state.confirm.mockClear().mockResolvedValue(true);
  state.close.mockClear();
  state.refetch.mockClear();
});

describe("the open walks", () => {
  it("asks for the open walks of the unit it is given", () => {
    render({ vehicleId: "22222222-2222-4222-8222-222222222222" });
    expect(state.filter!.value).toEqual({
      status: "open",
      vehicleId: "22222222-2222-4222-8222-222222222222",
      trailerId: undefined,
    });
  });

  it("draws nothing when nothing is open", () => {
    expect(render().text()).toBe("");
  });

  /** The row is Continue. Emitted through `DataTable`'s own event: jsdom draws no `<tr>` to click. */
  const clickRow = async (w: ReturnType<typeof render>, row: CountSessionDto) => {
    w.findComponent({ name: "DataTable" }).vm.$emit("row-click", row);
    await w.vm.$nextTick();
  };

  it("names each walk, and opening a row continues that walk", async () => {
    state.sessions = [walk(), walk({ id: "33333333-3333-4333-8333-333333333333", kind: "location", holderLabel: "Main bay" })];
    const w = render();
    expect(w.text()).toContain("Equipment check — 654");
    expect(w.text()).toContain("Shelf count — Main bay");
    await clickRow(w, walk());
    expect(state.pushed).toEqual([{ name: "count-session", params: { sessionId: walk().id } }]);
  });

  it("asks before closing, and closes that walk", async () => {
    state.sessions = [walk()];
    const w = render();
    await button(w, "Close")!.trigger("click");
    await flushPromises();
    expect(state.confirm).toHaveBeenCalledTimes(1);
    expect(state.close).toHaveBeenCalledWith({ id: walk().id });
  });

  it("closes nothing when the person backs out", async () => {
    state.sessions = [walk()];
    state.confirm.mockResolvedValue(false);
    const w = render();
    await button(w, "Close")!.trigger("click");
    await flushPromises();
    expect(state.close).not.toHaveBeenCalled();
  });

  it("shows a viewer the list without Close, and its rows open nothing", async () => {
    state.sessions = [walk()];
    state.manage = false;
    const w = render();
    expect(w.text()).toContain("Equipment check — 654");
    expect(button(w, "Close")).toBeUndefined();
    await clickRow(w, walk());
    expect(state.pushed).toEqual([]);
  });

  it("draws a failed read with a Retry, not as nothing open", async () => {
    state.failed = true;
    const w = render();
    expect(w.text()).toContain("Could not load the open counts.");
    await w.findAll("button").find((b) => /retry/i.test(b.text()))!.trigger("click");
    expect(state.refetch).toHaveBeenCalled();
  });
});
