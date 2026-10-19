import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import type { RoadsideInspectionDto, RoadsideInspectionWorkDto } from "@silvicom/shared";

/**
 * Officer's reports, many at once (IC15). What it can get wrong:
 *
 *   1. **Files a report on a guessed inspection** — one the name did not match, with nobody choosing.
 *   2. **Files on the wrong inspection** after a person changed the choice.
 *   3. **One failure stops the rest**, or is not said on its own row.
 *   4. **The choices bury the inspections still waiting for their report.**
 */

const uploads: { inspectionId: string; name: string }[] = [];
let failName: string | null = null;
vi.mock("./useRoadsideInspections", () => ({
  useUploadReportTo: () => ({
    mutateAsync: vi.fn(async (input: { inspectionId: string; file: File }) => {
      if (input.file.name === failName) throw new Error("The upload failed.");
      uploads.push({ inspectionId: input.inspectionId, name: input.file.name });
    }),
  }),
}));
const toasts: string[] = [];
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: (t: string) => toasts.push(t) }) }));

const Drawer = (await import("./BulkReportUploadDrawer.vue")).default;

const insp = (id: string, reportNumber: string, inspectionDate: string): RoadsideInspectionDto => ({
  id, reportNumber, reportState: "IL", inspectionDate, level: 2, locationDesc: null, hazmatPlacardRequired: false,
  violations: 1, driverOos: 0, vehicleOos: 0, hazmatOos: 0,
});
const INSPECTIONS = [insp("a", "3282002265", "2026-10-06"), insp("b", "CV44901292", "2026-10-09"), insp("c", "1455001139", "2026-09-01")];
const work = new Map<string, RoadsideInspectionWorkDto>([
  ["c", { id: "c", driver: null, open: { total: 1, byOwner: { safety: 1, maintenance: 0 } }, next: null, points: 0, awaitsReport: true }],
]);
const file = (name: string) => new File(["%PDF"], name, { type: "application/pdf" });

const Choice = { name: "AppCombobox", props: ["modelValue", "options"], emits: ["update:modelValue"], template: "<select data-test='choice' :data-value='modelValue' />" };
const Dropzone = { name: "FileDropzone", emits: ["files"], template: "<div data-test='dropzone' />" };

async function drawer() {
  const w = mount(Drawer, {
    props: { open: true, inspections: INSPECTIONS, work },
    global: {
      stubs: {
        // The drawer's body, without HeadlessUI's portal and focus trap.
        SlideOver: { template: "<div><slot /><slot name='footer' /></div>" },
        FileDropzone: Dropzone,
        AppCombobox: Choice,
      },
    },
  });
  await flushPromises();
  return w;
}
const drop = async (w: Awaited<ReturnType<typeof drawer>>, names: string[]) => {
  w.findComponent(Dropzone).vm.$emit("files", names.map(file));
  await flushPromises();
};

beforeEach(() => {
  setActivePinia(createPinia());
  uploads.length = 0;
  toasts.length = 0;
  failName = null;
});

describe("uploading officer's reports", () => {
  it("proposes each file's inspection from its name, files only those with one, and skips the rest", async () => {
    const w = await drawer();
    await drop(w, ["3282002265.pdf", "IMG_0042.jpg"]);
    expect(w.findAll("[data-test='choice']").map((c) => c.attributes("data-value"))).toEqual(["a", ""]);
    expect(w.get("[data-test='bulk-file-all']").text()).toBe("File 1 report");
    await w.get("[data-test='bulk-file-all']").trigger("click");
    await flushPromises();
    expect(uploads).toEqual([{ inspectionId: "a", name: "3282002265.pdf" }]);
    expect(toasts).toEqual(["1 report filed"]);
  });

  it("files on the inspection a person chose, over the one the name proposed", async () => {
    const w = await drawer();
    await drop(w, ["3282002265.pdf"]);
    w.findComponent(Choice).vm.$emit("update:modelValue", "b");
    await flushPromises();
    await w.get("[data-test='bulk-file-all']").trigger("click");
    await flushPromises();
    expect(uploads).toEqual([{ inspectionId: "b", name: "3282002265.pdf" }]);
  });

  it("goes on past a failed file and says so under it", async () => {
    failName = "3282002265.pdf";
    const w = await drawer();
    await drop(w, ["3282002265.pdf", "CV44901292.pdf"]);
    await w.get("[data-test='bulk-file-all']").trigger("click");
    await flushPromises();
    expect(uploads).toEqual([{ inspectionId: "b", name: "CV44901292.pdf" }]);
    expect(w.findAll("[data-test='bulk-file']").map((r) => r.attributes("data-state"))).toEqual(["failed", "filed"]);
    expect(w.get("[role='alert']").text()).toBe("The upload failed.");
  });

  it("lists the inspections waiting for their report first, then the newest", async () => {
    const w = await drawer();
    await drop(w, ["scan.pdf"]);
    const options = w.findComponent(Choice).props("options") as { value: string; label: string }[];
    expect(options.map((o) => o.value)).toEqual(["c", "b", "a"]);
    expect(options[0]!.label).toContain("waiting for its report");
  });
});
