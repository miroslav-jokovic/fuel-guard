import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { mount } from "@vue/test-utils";

const link = vi.hoisted(() => ({ q: null as unknown }));
vi.mock("vue-router", () => ({ useRoute: () => ({ params: { token: "tok" } }) }));
vi.mock("@/features/apply/useApplication", () => ({ useApplyInvitationQuery: () => link.q }));
vi.mock("@/pages/ApplyPage.vue", () => ({ default: { name: "ApplyPage", template: "<div data-application-page />" } }));
vi.mock("@/features/apply/DocumentsOnlyScreen.vue", () => ({
  default: { name: "DocumentsOnlyScreen", props: ["token", "bundle"], template: "<div data-documents-screen />" },
}));
const ApplyDoorPage = (await import("./ApplyDoorPage.vue")).default;

/**
 * Which page a link opens (Q-AM19, 0608). The application's page reads phases, releases and a draft
 * from its first tick, and the documents bundle has none — so the choice is made above it, and only
 * once the link has answered.
 */
const state = (over: { loading?: boolean; data?: unknown; error?: boolean } = {}) => {
  link.q = { isLoading: ref(over.loading ?? false), isError: ref(over.error ?? false), data: ref(over.data) };
};
const DOCS = { documentsOnly: true, carrier: "Silvicom Inc", expiresAt: "2026-11-28T00:00:00Z", localKey: "k", captures: [], offeredDocumentSlots: [] };

beforeEach(() => state());

describe("the door", () => {
  it("⚠ mounts neither page while the link has not answered", () => {
    state({ loading: true });
    const w = mount(ApplyDoorPage);
    expect(w.find("[data-application-page]").exists()).toBe(false);
    expect(w.find("[data-documents-screen]").exists()).toBe(false);
  });

  it("⚠ opens the documents screen for a documents link, and never the application's page", () => {
    state({ data: DOCS });
    const w = mount(ApplyDoorPage);
    expect(w.findComponent({ name: "DocumentsOnlyScreen" }).props()).toEqual({ token: "tok", bundle: DOCS });
    expect(w.find("[data-application-page]").exists()).toBe(false);
    expect(w.emitted("carrier")).toEqual([["Silvicom Inc"]]);
  });

  it("opens the application's page for one of its own links, and passes its two reports up", () => {
    state({ data: { carrier: "Silvicom Inc", phases: {} } });
    const w = mount(ApplyDoorPage);
    expect(w.find("[data-application-page]").exists()).toBe(true);
    w.findComponent({ name: "ApplyPage" }).vm.$emit("carrier", "Silvicom Inc");
    w.findComponent({ name: "ApplyPage" }).vm.$emit("wide", true);
    expect(w.emitted("carrier")).toEqual([["Silvicom Inc"]]);
    expect(w.emitted("wide")).toEqual([[true]]);
  });

  it("leaves a dead link to the application's page, which holds what this phone remembers of it", () => {
    state({ error: true });
    expect(mount(ApplyDoorPage).find("[data-application-page]").exists()).toBe(true);
  });

  it("does not take a bundle for a documents link unless it says so itself", () => {
    state({ data: { carrier: "x", documentsOnly: "yes" } });
    expect(mount(ApplyDoorPage).find("[data-application-page]").exists()).toBe(true);
  });
});
