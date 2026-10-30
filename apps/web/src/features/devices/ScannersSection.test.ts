import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { computed, ref } from "vue";
import type { ScannerDto } from "@silvicom/shared";

/**
 * Settings → Scanners (SCANNER-RELAY-PLAN.md SR4). Pinned:
 *   · each row says, in the shop's words, whether the station reads it, who uses it, and whether the
 *     last scan reached anybody — the three questions the 10/30 test raised;
 *   · "Use on this device" is offered to anybody who can see the page; a scanner somebody else holds
 *     is asked about BY NAME before it is taken over, and declining changes nothing;
 *   · Add, Edit and Retire only to someone who may manage.
 */

const state = vi.hoisted(() => ({
  scanners: [] as unknown[],
  held: null as { id: string; name: string } | null,
  take: vi.fn(),
  release: vi.fn(async () => {}),
  confirm: vi.fn(async () => true),
  update: vi.fn(async (_v: unknown) => ({})),
}));
vi.mock("@/composables/useScanners", async (orig) => ({
  SCANNER_STATUS_TEXT: (await orig<typeof import("@/composables/useScanners")>()).SCANNER_STATUS_TEXT,
  useScannersQuery: () => ({ data: computed(() => state.scanners), isLoading: ref(false), isError: ref(false), refetch: vi.fn() }),
  useUpdateScanner: () => ({ mutateAsync: state.update, isPending: ref(false) }),
}));
vi.mock("@/stores/scannerRelay", () => ({
  useScannerRelayStore: () => ({
    get held() {
      return state.held;
    },
    take: state.take,
    release: state.release,
  }),
}));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));
vi.mock("@silvicom/ui", async (orig) => ({ ...(await orig<typeof import("@silvicom/ui")>()), useConfirm: () => state.confirm }));

const ScannersSection = (await import("./ScannersSection.vue")).default;

enableAutoUnmount(afterEach);

const scanner = (over: Partial<ScannerDto> = {}): ScannerDto => ({
  id: "55555555-5555-4555-8555-555555555555",
  name: "Office scanner",
  stationId: "66666666-6666-4666-8666-666666666666",
  stationName: "Office PC",
  portName: "COM3",
  retired: false,
  status: "ready",
  statusDetail: "COM3",
  holder: null,
  lastReadAt: null,
  lastReadDelivered: null,
  ...over,
});
const STATION = { id: "66666666-6666-4666-8666-666666666666", name: "Office PC", paired: true, revoked: false, online: true } as never;

const render = async (manage = true) => {
  const w = mount(ScannersSection, {
    props: { stations: [STATION], manage },
    global: { stubs: { ScannerDrawer: true, KebabMenu: { template: "<div><slot /></div>" } } },
  });
  await flushPromises();
  return w;
};
const button = (w: Awaited<ReturnType<typeof render>>, text: string) => w.findAll("button").find((b) => b.text() === text);

beforeEach(() => {
  vi.clearAllMocks();
  state.held = null;
  state.confirm.mockResolvedValue(true);
});

describe("ScannersSection", () => {
  it("says the station cannot see it, who uses it, and that the last scan reached nobody", async () => {
    state.scanners = [
      scanner({
        status: "waiting",
        holder: { name: "Tom Tech", since: "2026-10-30T15:00:00Z", byYou: false },
        lastReadAt: "2026-10-30T15:01:00Z",
        lastReadDelivered: false,
      }),
    ];
    const w = await render();
    expect(w.text()).toContain("Not found");
    expect(w.text()).toContain("Tom Tech");
    expect(w.text()).toContain("nobody was using it");
  });

  it("this device holding it reads as such, and offers Stop", async () => {
    state.scanners = [scanner()];
    state.held = { id: scanner().id, name: "Office scanner" };
    const w = await render();
    expect(w.text()).toContain("This device");
    await button(w, "Stop using here")!.trigger("click");
    expect(state.release).toHaveBeenCalled();
  });

  it("asks by name before taking a scanner over, and declining changes nothing", async () => {
    state.scanners = [scanner()];
    state.take.mockResolvedValueOnce({ ok: false, heldBy: "Tom Tech" });
    state.confirm.mockResolvedValueOnce(false);
    const w = await render(false);
    await button(w, "Use on this device")!.trigger("click");
    await flushPromises();
    expect(state.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Tom Tech is using Office scanner" }));
    expect(state.take).toHaveBeenCalledTimes(1);
    expect(state.take).toHaveBeenCalledWith({ id: scanner().id, name: "Office scanner" });
  });

  it("taking over, once agreed, forces it", async () => {
    state.scanners = [scanner()];
    state.take.mockResolvedValueOnce({ ok: false, heldBy: "Tom Tech" }).mockResolvedValueOnce({ ok: true });
    const w = await render(false);
    await button(w, "Use on this device")!.trigger("click");
    await flushPromises();
    expect(state.take).toHaveBeenLastCalledWith({ id: scanner().id, name: "Office scanner" }, true);
  });

  it("offers Add, Edit and Retire only to someone who may manage", async () => {
    state.scanners = [scanner()];
    const viewer = await render(false);
    expect(button(viewer, "Add scanner")).toBeUndefined();
    expect(button(viewer, "Retire")).toBeUndefined();
    expect(button(viewer, "Use on this device")).toBeDefined();
    const manager = await render(true);
    expect(button(manager, "Add scanner")).toBeDefined();
    await button(manager, "Retire")!.trigger("click");
    await flushPromises();
    expect(state.update).toHaveBeenCalledWith({ id: scanner().id, patch: { retired: true } });
  });
});
