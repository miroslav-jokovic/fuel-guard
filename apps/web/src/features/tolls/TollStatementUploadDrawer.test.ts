import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia } from "pinia";
import { ref } from "vue";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import TollStatementUploadDrawer from "./TollStatementUploadDrawer.vue";

/**
 * The upload drawer (TOLLS-PER-TRUCK-PLAN.md TL4a): nothing can be dropped until a provider is chosen,
 * every file goes up under that provider one after another, and each file's outcome is its own line,
 * so one refused file does not take the stack with it.
 */
const state = vi.hoisted(() => ({ sent: [] as Array<{ provider: string; name: string }>, answers: new Map<string, unknown>() }));
vi.mock("./useTollStatements", async (orig) => {
  const actual = (await orig()) as typeof import("./useTollStatements");
  return {
    ...actual,
    useUploadTollStatement: () => ({
      isPending: ref(false),
      mutateAsync: async ({ provider, file }: { provider: string; file: File }) => {
        state.sent.push({ provider, name: file.name });
        const a = state.answers.get(file.name);
        if (a === "duplicate") throw new actual.TollStatementRefused("This file is already on the list, as EZ June.csv under E-ZPass.", "already_uploaded");
        if (a === "picture") throw new actual.TollStatementRefused("photo.pdf is not a PDF, spreadsheet or CSV inside, whatever its name says.", "not_a_statement");
        return { id: file.name };
      },
    }),
  };
});

const file = (name: string) => new File(["x"], name);

async function mountDrawer() {
  state.sent.length = 0;
  const w = mount(TollStatementUploadDrawer, { props: { open: true }, global: { plugins: [createPinia()] }, attachTo: document.body });
  await flushPromises();
  return w;
}
const q = (sel: string) => document.body.querySelector(sel);

describe("TollStatementUploadDrawer", () => {
  it("takes no file until the provider is chosen, and has no default provider", async () => {
    const w = await mountDrawer();
    const zone = w.findComponent(FileDropzone);
    expect(zone.props("disabled")).toBe(true);
    expect(zone.props("label")).toBe("Choose the provider first");
    zone.vm.$emit("files", [file("june.pdf")]);
    await flushPromises();
    expect(state.sent).toEqual([]);
    w.unmount();
  });

  it("sends every file under the chosen provider, in order, and gives each its own outcome", async () => {
    state.answers = new Map([["dup.csv", "duplicate"], ["photo.pdf", "picture"]]);
    const w = await mountDrawer();
    const select = q('[data-test="statement-provider"]') as HTMLSelectElement;
    select.value = "ktag";
    select.dispatchEvent(new Event("change"));
    await flushPromises();
    const zone = w.findComponent(FileDropzone);
    expect(zone.props("disabled")).toBe(false);
    expect(zone.props("label")).toBe("Drop the K-TAG statements here");
    zone.vm.$emit("files", [file("w1.pdf"), file("dup.csv"), file("photo.pdf"), file("w2.xlsx")]);
    await flushPromises();
    expect(state.sent).toEqual([
      { provider: "ktag", name: "w1.pdf" },
      { provider: "ktag", name: "dup.csv" },
      { provider: "ktag", name: "photo.pdf" },
      { provider: "ktag", name: "w2.xlsx" },
    ]);
    const lines = [...document.body.querySelectorAll('[data-test="statement-upload-row"]')].map((li) => li.textContent ?? "");
    expect(lines[0]).toContain("w1.pdf");
    expect(lines[0]).toContain("Uploaded");
    expect(lines[1]).toContain("Already on the list");
    expect(lines[1]).toContain("as EZ June.csv under E-ZPass");
    expect(lines[2]).toContain("Not uploaded");
    expect(lines[2]).toContain("whatever its name says");
    expect(lines[3]).toContain("Uploaded");
    expect(q('[data-test="statement-upload-summary"]')?.textContent).toContain("2 files are on the list");
    w.unmount();
  });
});
