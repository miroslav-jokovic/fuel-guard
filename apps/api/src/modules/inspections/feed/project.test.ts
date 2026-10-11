import { describe, it, expect } from "vitest";
import { createSupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { projectRoadside } from "./project.js";

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("projectRoadside (IC1b, 0458)", () => {
  it("asks the database to project this org only, and returns its counts as numbers", async () => {
    const rec = createSupabaseRecorder({ rpc: { roadside_project: [{ inspections: 3, units: 6, violations: 2, citations: 0 }] } });
    expect(await projectRoadside(rec.client, ORG)).toEqual({ inspections: 3, units: 6, violations: 2, citations: 0 });
    expect(rec.rpcs()).toEqual([{ fn: "roadside_project", args: { p_org: ORG } }]);
  });

  it("throws on the database's error rather than reporting an empty projection", async () => {
    const rec = createSupabaseRecorder({ rpc: { roadside_project: { error: { message: "boom" } } } });
    await expect(projectRoadside(rec.client, ORG)).rejects.toThrow(/roadside_project: boom/);
  });
});
