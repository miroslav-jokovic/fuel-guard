import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import type { IftaReceiptUploadResponse } from "@silvicom/shared";

/**
 * The driver-paid fuel dialog (IP8). What it must never do is import something the office has not
 * seen: the import button stays off while a row has no truck or while the file's own totals disagree
 * with its rows, a truck choice re-asks the server before the button turns on, and the import sends
 * exactly the choices the preview was computed with.
 */
const V512 = "5a1b2c3d-4e5f-4a6b-8c7d-000000000512";
const calls: Array<{ url: string; body: Record<string, unknown> | undefined }> = [];
const state = { disagree: false };

function answer(body: { commit: boolean; truckChoices: Record<string, string> }): IftaReceiptUploadResponse {
  const chosen = body.truckChoices["driver:driver a"];
  return {
    format: "fuel_app_csv",
    fileName: "IFTA Report_report.csv",
    fileSha256: "a".repeat(64),
    rows: [
      { line: 2, status: "new", jurisdiction: "OK", fueledOn: "2026-09-26", gallons: 100.211, station: "OnCue #145", unitAsFiled: null, driverAsFiled: "Driver A", vehicleId: V512, unitNumber: "512", truckBasis: "driver_assignment", truckKey: null },
      chosen
        ? { line: 3, status: "new", jurisdiction: "TX", fueledOn: "2026-09-20", gallons: 50, station: null, unitAsFiled: null, driverAsFiled: "Driver A", vehicleId: chosen, unitNumber: "512", truckBasis: "chosen_at_upload", truckKey: null }
        : { line: 3, status: "needs_truck", jurisdiction: "TX", fueledOn: "2026-09-20", gallons: 50, station: null, unitAsFiled: null, driverAsFiled: "Driver A", vehicleId: null, unitNumber: null, truckBasis: null, truckKey: "driver:driver a" },
    ],
    refused: [{ line: 9, reason: "DEF is not motor fuel, so it is not an IFTA purchase" }],
    voidedInSource: 0,
    statedTotals: [{ jurisdiction: null, stated: state.disagree ? 200 : 150.211, parsed: 150.211, agrees: !state.disagree }],
    truckQuestions: chosen ? [] : [{ key: "driver:driver a", label: "Driver A", rows: 1, why: "Samsara had this driver in two trucks on some of these days.", suggestion: { vehicleId: V512, unitNumber: "512" } }],
    committed: body.commit ? { uploadId: "u-1", imported: 2, alreadyPresent: 0 } : null,
  };
}

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string, init?: { body?: Record<string, unknown> }) => {
    calls.push({ url, body: init?.body });
    if (url === "/api/ifta/receipt-uploads" && init?.body) {
      return { ok: true, data: answer(init.body as { commit: boolean; truckChoices: Record<string, string> }) };
    }
    return { ok: true, data: { uploads: [] } };
  }),
}));
vi.mock("@/composables/useVehicles", async () => {
  const { ref } = await import("vue");
  return { useVehiclesQuery: () => ({ data: ref([{ id: V512, unit_number: "512" }]) }) };
});
vi.mock("./useReceiptUploads", async (orig) => ({
  ...(await orig<typeof import("./useReceiptUploads")>()),
  fileToBase64: async () => "QQ==",
}));

import DriverFuelUploadDialog from "./DriverFuelUploadDialog.vue";
import { useToastStore } from "@/stores/toast";

// The modal's portal and the dropzone's picker are not what is under test; each renders in place.
const Inline = defineComponent({ setup: (_, { slots }) => () => h("div", slots.default?.()) });
const Drop = defineComponent({
  emits: ["files"],
  setup: (_, { emit }) => () => h("button", { "data-testid": "drop", onClick: () => emit("files", [new File(["x"], "IFTA Report_report.csv")]) }),
});

function mountDialog(canManage = true) {
  return mount(DriverFuelUploadDialog, {
    props: { open: true, canManage },
    global: {
      plugins: [[VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]],
      stubs: { BaseModal: Inline, FileDropzone: Drop },
    },
  });
}
const importButton = (w: ReturnType<typeof mountDialog>) => w.findAll("button").find((b) => b.text().startsWith("Import"))!;

beforeEach(() => {
  setActivePinia(createPinia());
  calls.length = 0;
  state.disagree = false;
});

describe("DriverFuelUploadDialog", () => {
  it("previews without importing, and keeps Import off while a row has no truck", async () => {
    const w = mountDialog();
    await w.find('[data-testid="drop"]').trigger("click");
    await flushPromises();
    expect(calls.filter((c) => c.body).map((c) => c.body!.commit)).toEqual([false]);
    expect(w.find('[data-testid="upload-summary"]').text()).toContain("2 fills");
    expect(w.find('[data-testid="upload-summary"]').text()).toContain("1 need a truck");
    expect(w.find('[data-testid="refused"]').text()).toContain("line 9, DEF is not motor fuel");
    expect(w.find('[data-testid="truck-question"]').text()).toContain("points at unit 512");
    expect(importButton(w).attributes("disabled")).toBeDefined();
  });

  it("re-asks the server when a truck is chosen, then imports with exactly that choice", async () => {
    const w = mountDialog();
    await w.find('[data-testid="drop"]').trigger("click");
    await flushPromises();
    w.findComponent({ name: "AppCombobox" }).vm.$emit("update:modelValue", V512);
    await flushPromises();
    const posts = () => calls.filter((c) => c.body);
    expect(posts().map((c) => [c.body!.commit, c.body!.truckChoices])).toEqual([
      [false, {}],
      [false, { "driver:driver a": V512 }],
    ]);
    expect(importButton(w).attributes("disabled")).toBeUndefined();
    expect(importButton(w).text()).toBe("Import 2 fills");

    const toast = useToastStore();
    const spy = vi.spyOn(toast, "success");
    await importButton(w).trigger("click");
    await flushPromises();
    expect(posts()[2]!.body).toMatchObject({ commit: true, truckChoices: { "driver:driver a": V512 }, contentBase64: "QQ==" });
    expect(spy).toHaveBeenCalledWith("Imported 2 fills", "150 gal added to the IFTA credit.");
  });

  it("refuses to import a file whose own totals disagree with its rows", async () => {
    state.disagree = true;
    const w = mountDialog();
    await w.find('[data-testid="drop"]').trigger("click");
    await flushPromises();
    w.findComponent({ name: "AppCombobox" }).vm.$emit("update:modelValue", V512);
    await flushPromises();
    expect(w.find('[data-testid="totals-disagree"]').text()).toContain("file says 200");
    expect(importButton(w).attributes("disabled")).toBeDefined();
  });

  it("shows a reader without fuel management the uploads, and no way to add one", async () => {
    const w = mountDialog(false);
    await flushPromises();
    expect(w.find('[data-testid="drop"]').exists()).toBe(false);
    expect(w.text()).toContain("Only people who manage fuel can upload");
  });
});
