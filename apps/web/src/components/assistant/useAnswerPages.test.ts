import { describe, expect, it, vi } from "vitest";
import { MODULE_KEYS, type ModuleSet } from "@silvicom/shared";

/**
 * The "Open in …" links (F21 R4a) are drawn only for pages this person can open, by the sidebar's own
 * two questions, never assumed from the answer. Since Q-AI12 (2026-11-11) every page's gate equals its
 * tool's, so the matrix alone no longer splits them; a per-person screen answer, a module the carrier
 * did not buy, or an API that names a page outside this person's sections still must not draw a link.
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
    // A recruiter holds `fuel: "none"`: the fuel pages are closed, the applicants board is theirs.
    session.role = "recruiter";
    expect(useAnswerPages().value(["fuel.spend", "recruitment.applicants", "fuel.ifta"]).map((s) => s.key)).toEqual(["recruitment.applicants"]);
  });

  it("draws Fuel costs for a fuel VIEWER since Q-AI12 — the page now asks what its report route asks", () => {
    session.role = "accountant";
    expect(useAnswerPages().value(["fuel.spend", "fuel.ifta"]).map((s) => s.key)).toEqual(["fuel.spend", "fuel.ifta"]);
  });

  it("follows the org's screen answers: a surface turned off for this person has no link", () => {
    session.role = "admin";
    session.surfaces = { "fuel.ifta": false };
    expect(useAnswerPages().value(["fuel.ifta"])).toEqual([]);
    session.surfaces = null;
  });
});
