import { describe, expect, it, vi } from "vitest";
import type { ModuleSet } from "@silvicom/shared";

/**
 * The web's tool list is the endpoint's (F21 R5), including the carrier's modules since R6b: a
 * dispatch question is never offered to a carrier without Dispatch, because the API would withhold
 * the tool and the button would produce an apology.
 */
const session = { isAuthenticated: true, role: "admin", sections: null, surfaces: null };
const modules: { data: { value: ModuleSet | null } } = { data: { value: null } };
vi.mock("@/stores/session", () => ({ useSessionStore: () => session }));
vi.mock("@/composables/useModules", () => ({ useModulesQuery: () => modules }));
const { useAssistantTools } = await import("./useAssistantAccess");

describe("useAssistantTools", () => {
  it("offers fleet_now only when the carrier has Dispatch", () => {
    modules.data.value = new Set();
    expect(useAssistantTools().value).not.toContain("fleet_now");
    modules.data.value = new Set(["dispatch"]);
    expect(useAssistantTools().value).toContain("fleet_now");
  });
  it("before the modules have loaded, no module-gated tool is offered", () => {
    modules.data.value = null;
    expect(useAssistantTools().value).not.toContain("fleet_now");
    expect(useAssistantTools().value).toContain("fuel_report");
  });
});
