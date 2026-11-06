import { describe, expect, it } from "vitest";
import { JOB_KIND_CATALOGUE, jobItem, jobKindEntry, type CataloguedJobKind } from "@silvicom/shared";
import { registerAllHandlers } from "../../queue/handlers/index.js";
import { registeredKinds } from "../../queue/registry.js";
import type { JobKind } from "./jobs.js";

/**
 * The job-kind catalogue (`packages/shared/src/jobKindCatalogue.ts`, E5, 2026-11-06) names every kind the API
 * has, and no other. Two-way, at compile time: a `JobKind` added here without an entry, or an entry naming no
 * kind, fails `pnpm typecheck` on the two lines below. Then at run time, against the kinds the queue really
 * registers, so a handler wired under a name the type does not hold is caught too.
 */
type Missing = Exclude<JobKind, CataloguedJobKind>;
type Extra = Exclude<CataloguedJobKind, JobKind>;
const noneMissing: [Missing] extends [never] ? true : Missing = true;
const noneExtra: [Extra] extends [never] ? true : Extra = true;

describe("the job-kind catalogue covers every job kind (E5)", () => {
  it("has an entry for every kind the queue registers, each with an office label", () => {
    expect([noneMissing, noneExtra]).toEqual([true, true]);
    registerAllHandlers();
    const kinds = registeredKinds();
    expect(kinds.length).toBeGreaterThan(10);
    for (const k of kinds) expect(Object.keys(JOB_KIND_CATALOGUE), k).toContain(k);
    for (const e of Object.values(JOB_KIND_CATALOGUE)) expect(e.label).toMatch(/^[A-Z][a-z]/);
  });

  it("every ads kind tells an office person what to do, and names the item its payload carries", () => {
    for (const [k, e] of Object.entries(JOB_KIND_CATALOGUE).filter(([, e]) => e.area === "ads")) expect((e as { hint?: string }).hint, k).toBeTruthy();
    expect(jobItem("ads_insights", { connectionId: "c-1", days: 3 })).toEqual({ noun: "Ad account", id: "c-1" });
    expect(jobItem("ads_insights", {})).toBeNull();
    expect(jobItem("rebuild", { connectionId: "c-1" })).toBeNull();
  });

  it("a kind this build does not know is shown by its own name, not hidden", () => {
    expect(jobKindEntry("some_new_job")).toEqual({ label: "some new job", area: "platform" });
  });
});
