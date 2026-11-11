import { describe, expect, it, vi } from "vitest";
import { MODULE_KEYS, type ModuleSet } from "@silvicom/shared";

/**
 * The "Open in …" links (F21 R4a) are drawn only for pages this person can open, by the sidebar's own
 * two questions, never assumed from the answer: Fuel costs asks `manage("fuel")` while its report
 * route answers `view`, so an accountant can get a `fuel_report` answer and no link to a page that
 * would refuse them.
 */
const session: { isAuthenticated: boolean; role: string; sections: unknown; surfaces: unknown } = { isAuthenticated: true, role: "admin", sections: null, surfaces: null };
const modules: { data: { value: ModuleSet | null } } = { data: { value: new Set(MODULE_KEYS) as ModuleSet } };
vi.mock("@/stores/session", () => ({ useSessionStore: () => session }));
vi.mock("@/composables/useModules", () => ({ useModulesQuery: () => modules }));
const { useAnswerPages } = await import("./useAnswerPages");

describe("useAnswerPages", () => {
  it("resolves the API's keys to the catalogue's label and path, skipping a key this web does not know", () => {
    session.role = "admin";
    expect(useAnswerPages().value(["fuel.spend", "finance.fleet-report", "not.a.surface"]).map((s) => [s.label, s.path])).toEqual([
      ["Fuel costs", "/fuel-spend"],
      ["Fleet report", "/fleet-report"],
    ]);
    expect(useAnswerPages().value(undefined)).toEqual([]);
  });

  it("draws no link to a page the person cannot open", () => {
    session.role = "accountant";
    expect(useAnswerPages().value(["fuel.spend", "fuel.ifta"]).map((s) => s.key)).toEqual(["fuel.ifta"]);
  });

  it("follows the org's screen answers: a surface turned off for this person has no link", () => {
    session.role = "admin";
    session.surfaces = { "fuel.ifta": false };
    expect(useAnswerPages().value(["fuel.ifta"])).toEqual([]);
    session.surfaces = null;
  });
});
