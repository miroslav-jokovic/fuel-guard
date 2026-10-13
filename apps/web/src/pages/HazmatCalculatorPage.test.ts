import { describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { canManageSection, USER_ROLES } from "@silvicom/shared";

/**
 * The BOL panel is shown to exactly the roles the API lets send a document (`hazmat` manage, the routes'
 * gate in documents.ts) — read from the matrix over every role, so a role the matrix changes moves with
 * it. The test also requires the matrix to split the roles: a matrix where everyone (or no one) manages
 * hazmat would make "shown iff it can manage" hold without the page checking anything.
 */
const role = vi.hoisted(() => ({ value: "dispatcher" as string }));
vi.mock("@/stores/session", () => ({
  useSessionStore: () => ({ can: (s: string) => canManageSection(role.value as never, s as never) }),
}));
const Stub = (name: string) => defineComponent({ name, setup: () => () => h("div", { "data-stub": name }) });
vi.mock("@/features/hazmat/HazmatCalculatorForm.vue", () => ({
  default: defineComponent({ name: "CalculatorFormStub", props: { bolRead: { type: Object, default: null } }, setup: (p) => () => h("div", { "data-stub": "form", "data-read": (p.bolRead as { id?: string } | null)?.id ?? "" }) }),
}));
vi.mock("@/features/hazmat/bolRead/BolReadPanel.vue", () => ({
  default: defineComponent({ name: "BolPanelStub", emits: ["read"], setup: (_, { emit }) => () => h("button", { "data-stub": "bol-panel", onClick: () => emit("read", { id: "read-1" }) }) }),
}));
vi.mock("@/components/ui/PageHeader.vue", () => ({ default: Stub("header") }));

const { default: HazmatCalculatorPage } = await import("./HazmatCalculatorPage.vue");

describe("HazmatCalculatorPage", () => {
  it("shows the BOL panel to exactly the roles that manage the hazmat section, and the form to everyone", () => {
    const shown = USER_ROLES.map((r) => {
      role.value = r;
      const w = mount(HazmatCalculatorPage);
      expect(w.find("[data-stub='form']").exists()).toBe(true);
      return [r, w.find("[data-stub='bol-panel']").exists()] as const;
    });
    expect(shown).toEqual(USER_ROLES.map((r) => [r, canManageSection(r, "hazmat")]));
    expect(new Set(shown.map(([, s]) => s)).size).toBe(2);
  });

  it("hands the panel's finished read to the form", async () => {
    role.value = "dispatcher";
    const w = mount(HazmatCalculatorPage);
    expect(w.find("[data-stub='form']").attributes("data-read")).toBe("");
    await w.find("[data-stub='bol-panel']").trigger("click");
    expect(w.find("[data-stub='form']").attributes("data-read")).toBe("read-1");
  });
});
