import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { computed, ref } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { SCANNER_TEST_PAYLOAD } from "@silvicom/shared";
import DevicesSettingsPage from "@/pages/DevicesSettingsPage.vue";

/**
 * Settings → Printers & scanners (PRINTERS-AND-SCANNERS-PLAN.md PS4). Pinned:
 *   · a station reads Online / Offline / Not paired from the API's answer, never a guess;
 *   · "Use for my labels" is offered to someone who may only VIEW (the API's rule), the organization's
 *     default and the test label only to someone who may manage;
 *   · no default printer is said out loud, because it is the one case Print will ask;
 *   · a scan of the test label on this device is diagnosed — works, or which setting is wrong.
 */

const state = vi.hoisted(() => ({
  manage: true,
  stations: [] as unknown[],
  printers: [] as unknown[],
  defaults: { organizationPrinterId: null as string | null, myPrinterId: null as string | null, effectivePrinterId: null as string | null },
  setDefault: vi.fn(async (_v: unknown) => ({})),
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => state.manage }) }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/composables/usePrinting", () => {
  const q = (get: () => unknown) => ({ data: computed(get), isLoading: ref(false), isError: ref(false), isSuccess: ref(true), refetch: vi.fn() });
  const m = (fn: unknown = vi.fn(async () => ({}))) => ({ mutateAsync: fn, isPending: ref(false) });
  return {
    useStationsQuery: () => q(() => state.stations),
    usePrintersQuery: () => q(() => state.printers),
    usePrintDefaultsQuery: () => q(() => state.defaults),
    usePrintJobsQuery: () => q(() => []),
    useRenewPairingCode: () => m(),
    useRevokeStation: () => m(),
    useSetDefaultPrinter: () => m(state.setDefault),
    usePrintTestLabel: () => m(),
    useUpdatePrinter: () => m(),
    useCreateStation: () => m(),
    useCreatePrinter: () => m(),
    jobStatusText: () => "",
  };
});

enableAutoUnmount(afterEach);

const station = (over: Record<string, unknown>) => ({
  id: "st-1",
  name: "Office PC",
  paired: true,
  online: true,
  lastSeenAt: "2026-10-28T15:00:00Z",
  hostName: "OFFICE-PC",
  agentVersion: "1.0.0",
  revoked: false,
  pairingExpiresAt: null,
  discoveredPrinters: [{ name: "MUNBYN RW403B" }],
  ...over,
});
const PRINTER = {
  id: "p-1",
  name: "Shop label printer",
  stationId: "st-1",
  stationName: "Office PC",
  systemName: "MUNBYN RW403B",
  language: "tspl",
  stockId: "roll-single",
  dpi: 203,
  offsetXDots: 0,
  offsetYDots: 0,
  online: true,
  retired: false,
};

const render = async () => {
  const w = mount(DevicesSettingsPage, {
    // The menu's items render open, so what each role is OFFERED can be read.
    global: { stubs: { PageHeader: true, StationDrawer: true, PrinterDrawer: true, SlideOver: true, ScannersSection: true, KebabMenu: { template: "<div><slot /></div>" } } },
  });
  await flushPromises();
  return w;
};

beforeEach(() => {
  setActivePinia(createPinia());
  state.manage = true;
  state.stations = [];
  state.printers = [];
  state.defaults = { organizationPrinterId: null, myPrinterId: null, effectivePrinterId: null };
  state.setDefault.mockClear();
});

describe("print stations", () => {
  it("reads Online, Offline and Not paired from the API", async () => {
    state.stations = [station({}), station({ id: "st-2", name: "Shop PC", online: false }), station({ id: "st-3", name: "New", paired: false, online: false })];
    const text = (await render()).find("[data-testid=stations]").text();
    expect(text).toMatch(/Office PC[\s\S]*Online/);
    expect(text).toMatch(/Shop PC[\s\S]*Offline/);
    expect(text).toMatch(/New[\s\S]*Waiting to be paired[\s\S]*Not paired/);
  });

  it("says so when there is no station at all", async () => {
    expect((await render()).text()).toContain("No print station yet");
  });
});

describe("default printers", () => {
  it("says Print will ask while no default is set", async () => {
    state.stations = [station({})];
    state.printers = [PRINTER];
    expect((await render()).text()).toContain("No default printer is set, so Print will ask");
  });

  it("offers a viewer their own default, and nothing that needs manage", async () => {
    state.manage = false;
    state.stations = [station({})];
    state.printers = [PRINTER];
    const buttons = (await render()).findAll("button").map((b) => b.text());
    expect(buttons).toContain("Use for my labels");
    expect(buttons).not.toContain("Use for everyone");
    expect(buttons).not.toContain("Print a test label");
    expect(buttons).not.toContain("Add print station");
  });

  it("sets the organization's default from the row", async () => {
    state.stations = [station({})];
    state.printers = [PRINTER];
    const w = await render();
    await w.findAll("button").find((b) => b.text() === "Use for everyone")!.trigger("click");
    await flushPromises();
    expect(state.setDefault).toHaveBeenCalledWith({ scope: "organization", printerId: "p-1" });
  });

  it("names who each printer prints for", async () => {
    state.stations = [station({})];
    state.printers = [PRINTER];
    state.defaults = { organizationPrinterId: "p-1", myPrinterId: "p-1", effectivePrinterId: "p-1" };
    expect((await render()).text()).toContain("Everyone · You");
  });
});

describe("the scanner test", () => {
  const scan = (text: string) => {
    for (const ch of text) document.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  };

  it("says a clean read works", async () => {
    const w = await render();
    scan(SCANNER_TEST_PAYLOAD);
    await flushPromises();
    expect(w.find("[data-testid=scanner-verdict]").text()).toContain("Works");
  });

  it("names the keyboard layout when the punctuation comes out wrong", async () => {
    const w = await render();
    scan(SCANNER_TEST_PAYLOAD.replace(/:/g, "Ö").replace("-", "ß"));
    await flushPromises();
    expect(w.find("[data-testid=scanner-verdict]").text()).toContain("not using a US English keyboard");
  });
});
