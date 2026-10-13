import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import FileDropzone from "@/components/ui/FileDropzone.vue";

/** D-US6 — the dry run's counts are a FactList; "Written" joins them only once the import is applied. */
const api = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (_url: string, opts: { body: { dryRun: boolean } }) => {
    api.calls++;
    return { ok: true, data: { errors: [], matches: [{}, {}, {}], rejects: [{ reason: "ambiguous", label: "J. Smith" }], applied: opts.body.dryRun ? 0 : 3 } };
  }),
}));
const DobImportCard = (await import("./DobImportCard.vue")).default;

beforeEach(() => setActivePinia(createPinia()));

describe("the date-of-birth import counts", () => {
  it("shows matched and not-imported after the preview, and what was written after the import", async () => {
    const w = mount(DobImportCard, { global: { plugins: [VueQueryPlugin], stubs: { RouterLink: true } } });
    w.findComponent(FileDropzone).vm.$emit("files", [{ name: "dob.csv", text: async () => "csv" }]);
    await flushPromises();
    expect(w.findAll("dt").map((d) => d.text())).toEqual(["Matched", "Not imported"]);
    expect(w.findAll("dd").map((d) => d.text())).toEqual(["3", "1"]);

    await w.findAll("button").find((b) => b.text() === "Import 3 dates of birth")!.trigger("click");
    await flushPromises();
    expect(w.findAll("dt").map((d) => d.text())).toEqual(["Matched", "Not imported", "Written"]);
    expect(w.findAll("dd").map((d) => d.text())).toEqual(["3", "1", "3"]);
  });
});
