import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { computed, ref } from "vue";

/**
 * "Use the office scanner" on the Scan page (SCANNER-RELAY-PLAN.md SR4). Pinned:
 *   · a shop with no relayed scanner sees the Scan page exactly as before — nothing is drawn;
 *   · a scanner that is not ready says why, on the button;
 *   · holding one, the page says which and offers Stop.
 */

const state = vi.hoisted(() => ({
  scanners: [] as unknown[],
  held: null as { id: string; name: string } | null,
  take: vi.fn(async () => ({ ok: true })),
  release: vi.fn(async () => {}),
}));
vi.mock("@/composables/useScanners", async (orig) => ({
  SCANNER_STATUS_TEXT: (await orig<typeof import("@/composables/useScanners")>()).SCANNER_STATUS_TEXT,
  useScannersQuery: () => ({ data: computed(() => state.scanners), isLoading: ref(false), refetch: vi.fn() }),
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
vi.mock("@silvicom/ui", async (orig) => ({ ...(await orig<typeof import("@silvicom/ui")>()), useConfirm: () => async () => true }));

const UseOfficeScanner = (await import("./UseOfficeScanner.vue")).default;
enableAutoUnmount(afterEach);

const SCANNER = { id: "55555555-5555-4555-8555-555555555555", name: "Office scanner", retired: false, status: "ready" };

beforeEach(() => {
  vi.clearAllMocks();
  state.held = null;
});

describe("UseOfficeScanner", () => {
  it("draws nothing when the shop has no relayed scanner", async () => {
    state.scanners = [];
    const w = mount(UseOfficeScanner);
    await flushPromises();
    expect(w.find("[data-testid='use-office-scanner']").exists()).toBe(false);
  });

  it("offers each scanner, saying why one is not ready", async () => {
    state.scanners = [SCANNER, { ...SCANNER, id: "66666666-6666-4666-8666-666666666666", name: "Shop scanner", status: "station_offline" }];
    const w = mount(UseOfficeScanner);
    await flushPromises();
    expect(w.text()).toContain("Use Office scanner");
    expect(w.text()).toContain("Use Shop scanner");
    expect(w.text()).toContain("Station offline");
    await w.findAll("button")[0]!.trigger("click");
    expect(state.take).toHaveBeenCalledWith({ id: SCANNER.id, name: "Office scanner" });
  });

  it("holding one, says which and offers Stop", async () => {
    state.scanners = [SCANNER];
    state.held = { id: SCANNER.id, name: "Office scanner" };
    const w = mount(UseOfficeScanner);
    await flushPromises();
    expect(w.text()).toContain("Using Office scanner");
    await w.findAll("button").find((b) => b.text() === "Stop using")!.trigger("click");
    expect(state.release).toHaveBeenCalled();
  });
});
