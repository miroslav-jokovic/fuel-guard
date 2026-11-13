import { describe, expect, it } from "vitest";
import { EDITABLE_ROLES, rolesThatManage } from "./auth.js";
import { SURFACES } from "./surfaceCatalogue.js";
import { surfaceStartsOn } from "./surfaces.js";

/**
 * D-LRC11 (owner 2026-11-13: "dispatchers and billing and other users we select"). The Lumper fees screen
 * starts on for whoever manages Dispatch or Billing. The catalogue has to spell the roles out, because
 * `lint:surfaces` reads that file as text; this holds the spelled-out list equal to the matrix, so a role
 * given Dispatch or Billing tomorrow fails here until the screen is given to it too.
 */
describe("who the Lumper fees screen starts on for", () => {
  const surface = SURFACES.find((s) => s.key === "dispatch.lumper-cases")!;

  it("is exactly the editable roles that manage Dispatch or Billing", () => {
    const derived = EDITABLE_ROLES.filter((r) => rolesThatManage("dispatch").includes(r) || rolesThatManage("billing").includes(r));
    expect([...(surface.startsOnFor ?? [])].sort()).toEqual([...derived].sort());
  });

  it("starts on for dispatch and billing, off for the others, and an admin can change either", () => {
    expect(surfaceStartsOn(surface, "dispatcher")).toBe(true);
    expect(surfaceStartsOn(surface, "accountant")).toBe(true);
    expect(surfaceStartsOn(surface, "recruiter")).toBe(false);
    expect(surfaceStartsOn(surface, "auditor")).toBe(false);
    expect(surface.gate.kind).toBe("staff");
  });
});
