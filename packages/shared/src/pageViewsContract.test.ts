import { describe, expect, it } from "vitest";
import { SURFACES } from "./surfaceCatalogue.js";
import { acceptedPageViewKeys, pageViewKeyFor, pageViewsRecordSchema, PAGE_VIEW_BATCH_MAX } from "./pageViewsContract.js";

describe("page-view keys (X1)", () => {
  it("counts a declared route as its catalogue key", () => {
    expect(pageViewKeyFor("/fuel-log")).toBe("fuel.log");
  });

  it("counts a detail route as its own screen, keyed on the DECLARED path", () => {
    const detail = SURFACES.find((s) => s.path === "/fuel-cards/:id");
    expect(detail).toBeDefined();
    expect(pageViewKeyFor("/fuel-cards/:id")).toBe(detail!.key);
    // A concrete path is not a declared one, so it names no screen — the router must pass matched[0].path.
    expect(pageViewKeyFor("/fuel-cards/abc")).toBeNull();
  });

  it("does not count a route outside the catalogue", () => {
    expect(pageViewKeyFor("/login")).toBeNull();
  });

  it("every catalogue key fits the 0435 shape, so no real screen can be refused by the database", () => {
    const bad = SURFACES.map((s) => s.key).filter((k) => !pageViewsRecordSchema.safeParse({ keys: [k] }).success);
    expect(bad).toEqual([]);
  });

  it("keeps repeats and drops keys the catalogue no longer knows", () => {
    expect(acceptedPageViewKeys(["fuel.log", "gone.screen", "fuel.log"])).toEqual(["fuel.log", "fuel.log"]);
  });

  it("refuses a path, a query string, an empty batch and an oversized one", () => {
    expect(pageViewsRecordSchema.safeParse({ keys: ["/drivers/abc"] }).success).toBe(false);
    expect(pageViewsRecordSchema.safeParse({ keys: ["fuel.log?card=4111"] }).success).toBe(false);
    expect(pageViewsRecordSchema.safeParse({ keys: [] }).success).toBe(false);
    expect(pageViewsRecordSchema.safeParse({ keys: Array(PAGE_VIEW_BATCH_MAX + 1).fill("fuel.log") }).success).toBe(false);
  });
});
