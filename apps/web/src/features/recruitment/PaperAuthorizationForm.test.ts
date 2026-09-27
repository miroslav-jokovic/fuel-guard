import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { VueQueryPlugin, QueryClient } from "@tanstack/vue-query";
import { APPLICATION_RELEASE_ORDER, type AuthorizationPurpose } from "@silvicom/shared";
import PaperAuthorizationForm from "@/features/recruitment/PaperAuthorizationForm.vue";

const mutateAsync = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/features/recruitment/useAuthorizations", () => ({
  useRecordPaperAuthorization: () => ({ mutateAsync, isPending: { value: false } }),
}));

/**
 * Recording a paper signature (MV3). What is pinned: the preselection lands on the release that is
 * actually missing, the scan is required before anything is sent, and what IS sent names the
 * purpose, the name as written and the file — never any wording.
 */
const render = (signed: AuthorizationPurpose[]) =>
  mount(PaperAuthorizationForm, {
    props: { driverId: "driver-1", signed },
    global: {
      plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]],
      stubs: { AppCombobox: { props: ["modelValue", "options"], template: "<div data-test='purpose'>{{ modelValue }}</div>" } },
    },
  });

const button = (w: ReturnType<typeof render>) =>
  w.findAll("button").find((b) => b.text() === "Record paper signature")!;

beforeEach(() => {
  setActivePinia(createPinia());
  mutateAsync.mockClear();
});

describe("recording a paper signature", () => {
  it("preselects the one release still missing — the MVR release, for a link signed before D-MVR1", () => {
    const w = render(APPLICATION_RELEASE_ORDER.filter((p) => p !== "mvr"));
    expect(w.find("[data-test='purpose']").text()).toBe("mvr");
  });

  it("will not send without the scan", async () => {
    const w = render([]);
    await w.find("input").setValue("Marko Petrović");
    w.findComponent({ name: "AppDateField" }).vm.$emit("update:modelValue", "2026-09-20");
    await flushPromises();
    expect(button(w).attributes("disabled")).toBeDefined();
    await button(w).trigger("click");
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  /** G-9: the day on the page is required, and never defaulted to the day it is recorded. */
  it("will not send without the day on the signed page, and does not prefill one", async () => {
    const w = render([]);
    await w.find("input").setValue("Marko Petrović");
    w.findComponent({ name: "FileDropzone" }).vm.$emit("files", [new File(["%PDF-"], "signed.pdf", { type: "application/pdf" })]);
    await flushPromises();
    expect(w.findComponent({ name: "AppDateField" }).props("modelValue")).toBe("");
    expect(button(w).attributes("disabled")).toBeDefined();
  });

  it("sends the purpose, the name as written, the day on the page and the scan", async () => {
    const w = render(["fcra_disclosure"]);
    await w.find("input").setValue("Marko Petrović");
    w.findComponent({ name: "AppDateField" }).vm.$emit("update:modelValue", "2026-09-20");
    const file = new File(["%PDF-"], "signed.pdf", { type: "application/pdf" });
    w.findComponent({ name: "FileDropzone" }).vm.$emit("files", [file]);
    await flushPromises();
    await button(w).trigger("click");
    await flushPromises();
    expect(mutateAsync).toHaveBeenCalledWith({
      driverId: "driver-1",
      purpose: "psp",
      signedName: "Marko Petrović",
      signedOn: "2026-09-20",
      file,
    });
  });
});
