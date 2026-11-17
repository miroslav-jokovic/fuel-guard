import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, enableAutoUnmount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { ref } from "vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { TransponderDto, Vehicle } from "@silvicom/shared";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import TollTagImportDrawer from "./TollTagImportDrawer.vue";

/**
 * The toll-tag import drawer (TOLLS-PER-TRUCK-PLAN.md TL2b): a dropped sheet is shown line by line —
 * what each will do, and what to fix — before anything is written; only the lines that change
 * something are sent, in parts; and the API's answer per line replaces the preview's guess. `useMediaQuery`
 * is stubbed so DataTable renders a table, not cards.
 */
vi.mock("@vueuse/core", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useMediaQuery: () => ref(true) };
});
const state = vi.hoisted(() => ({
  grid: [] as unknown[][],
  sent: [] as Array<{ path: string; body: { rows: Array<{ line: number; unitNumber: string; at: string }> } }>,
  answer: null as null | ((rows: Array<{ line: number }>) => unknown),
}));
vi.mock("@/lib/reportGrid", () => ({ readReportGrid: async () => state.grid }));
vi.mock("@/lib/api", () => ({
  apiFetch: async (path: string, init: { body: { rows: Array<{ line: number; unitNumber: string; at: string }> } }) => {
    state.sent.push({ path, body: init.body });
    const rows = init.body.rows;
    return { ok: true, data: { results: state.answer ? state.answer(rows) : rows.map((r) => ({ line: r.line, outcome: "added", message: null })) } };
  },
}));
vi.mock("@/composables/useOrgTimezone", () => ({ useOrgTimezone: () => ({ zone: ref("America/Chicago") }) }));

const truck = (id: string, unit: string, status = "active") => ({ id, unit_number: unit, status }) as unknown as Vehicle;
const VEHICLES = [truck("v654", "654"), truck("v702", "702")];
const ON_702: TransponderDto = {
  id: "t1", provider: "ezpass", tagNumber: "00812345678", issuer: null, note: null, retiredAt: null, retiredReason: null, currentVehicleId: "v702",
  history: [{ id: "a1", vehicleId: "v702", unitNumber: "702", validFrom: "2026-03-01T06:00:00Z", validTo: null, voidedAt: null, voidReason: null }],
};
const HEAD = ["Truck", "Provider", "Tag number", "On truck since"];

async function mountDrawer(tags: TransponderDto[] = [ON_702]) {
  const w = mount(TollTagImportDrawer, {
    props: { open: true, vehicles: VEHICLES, tags },
    global: { plugins: [createPinia(), [VueQueryPlugin, { queryClient: new QueryClient() }]] },
    attachTo: document.body,
  });
  await flushPromises();
  return w;
}
async function drop(w: Awaited<ReturnType<typeof mountDrawer>>, grid: unknown[][]) {
  state.grid = grid;
  w.findComponent(FileDropzone).vm.$emit("files", [new File(["x"], "tags.xlsx")]);
  await flushPromises();
}
const lines = () => [...document.body.querySelectorAll('[data-test="tag-import-lines"] tbody tr')].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent!.trim()));
const runButton = () => document.body.querySelector('[data-test="tag-import-run"]') as HTMLButtonElement;

enableAutoUnmount(afterEach);
beforeEach(() => {
  state.sent.length = 0;
  state.answer = null;
});

describe("TollTagImportDrawer", () => {
  it("shows what every line will do before anything is sent, lines to fix first", async () => {
    const w = await mountDrawer();
    await drop(w, [
      HEAD,
      ["654", "K-TAG", "KT0000777", "05/14/2026"],
      ["654", "E-ZPass", "812345678", "06/01/2026"],
      ["702", "E-ZPass", "KT9999", "not a day"],
      ["702", null, null, null],
    ]);
    expect(state.sent).toEqual([]);
    expect(lines()).toEqual([
      ["4", "702", "E-ZPass KT9999", "Fix in the file", '"not a day" is not a date. Write it as MM/DD/YYYY.'],
      ["2", "654", "K-TAG KT0000777", "Add", "New tag, on unit 654 from 05/14/2026."],
      ["3", "654", "E-ZPass 812345678", "Move", "Moves from unit 702 to unit 654 on 06/01/2026."],
    ]);
    expect(document.body.textContent).toContain("1 truck line has no tag number and was skipped.");
    expect(runButton().textContent).toContain("Import 2 changes");
    w.unmount();
  });

  it("sends only the lines that change something, each day as midnight on the company's clock, and shows what the API did", async () => {
    state.answer = (rows) => rows.map((r) => (r.line === 3 ? { line: 3, outcome: "refused", message: "Another truck got this tag after that day." } : { line: r.line, outcome: "added", message: null }));
    const w = await mountDrawer();
    await drop(w, [HEAD, ["654", "K-TAG", "KT0000777", "05/14/2026"], ["654", "E-ZPass", "55556666", "06/01/2026"], ["702", "E-ZPass", "812345678", "04/01/2026"]]);
    runButton().click();
    await flushPromises();
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]!.path).toBe("/api/tolls/transponders/import");
    expect(state.sent[0]!.body.rows.map((r) => [r.line, r.unitNumber, r.at])).toEqual([
      [2, "654", "2026-05-14T05:00:00.000Z"],
      [3, "654", "2026-06-01T05:00:00.000Z"],
    ]);
    const after = lines();
    expect(after.find((l) => l[0] === "3")!.slice(3)).toEqual(["Not imported", "Another truck got this tag after that day."]);
    expect(after.find((l) => l[0] === "2")![3]).toBe("Added");
    expect(after.find((l) => l[0] === "4")![3]).toBe("Already right");
    expect(runButton()).toBeNull();
    w.unmount();
  });

  it("sends a long sheet in parts of fifty", async () => {
    const w = await mountDrawer([]);
    await drop(w, [HEAD, ...Array.from({ length: 120 }, (_, i) => ["654", "K-TAG", `KT${String(i).padStart(6, "0")}`, "05/14/2026"])]);
    runButton().click();
    await flushPromises();
    expect(state.sent.map((s) => s.body.rows.length)).toEqual([50, 50, 20]);
    w.unmount();
  });

  it("says what is wrong with a sheet it cannot use, and offers nothing to import", async () => {
    const w = await mountDrawer();
    await drop(w, [["Name", "Phone"], ["x", "y"]]);
    expect(document.body.querySelector('[data-test="tag-sheet-error"]')?.textContent).toContain("No header row found");
    expect(runButton().disabled).toBe(true);
    await drop(w, [HEAD, ["654", null, null, null]]);
    expect(document.body.querySelector('[data-test="tag-sheet-error"]')?.textContent).toContain("No line in this sheet has a tag number");
    w.unmount();
  });
});
