import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { ringNewLead } from "./leadNotify.js";

/** Who `lead_new` reaches (D2b). The access matrix's own answer is `sectionManagers`' test in `accessReview.test.ts`. */

const holder = vi.hoisted(() => ({ managers: vi.fn() }));
vi.mock("../../org/index.js", () => ({ sectionManagerIds: holder.managers }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const LEAD = "50000000-0000-4000-8000-000000000001";

let rec: SupabaseRecorder;
const rung = () => rec.rpcs().filter((c) => c.fn === "emit_notification").map((c) => c.args as Record<string, unknown>);

beforeEach(() => {
  rec = createSupabaseRecorder({ tables: { driver_app_features: [] }, rpc: () => "note-1" });
  holder.managers.mockReset().mockResolvedValue(["u-manager"]);
});

describe("lead_new", () => {
  it("rings the carrier's list, and not the managers, when there is one", async () => {
    await ringNewLead(rec.client as never, ORG, LEAD, async () => ["u-dana", "u-sam"]);
    expect(rung().map((a) => a.p_user)).toEqual(["u-dana", "u-sam"]);
    expect(holder.managers).not.toHaveBeenCalled();
  });

  it("with no list, rings who holds recruitment manage", async () => {
    await ringNewLead(rec.client as never, ORG, LEAD, async () => []);
    expect(holder.managers).toHaveBeenCalledWith(rec.client, ORG, "recruitment");
    expect(rung().map((a) => a.p_user)).toEqual(["u-manager"]);
  });

  it("carries the lead and a key of its own, so the database dedupes a repeat", async () => {
    await ringNewLead(rec.client as never, ORG, LEAD, async () => ["u-dana"]);
    expect(rung()[0]).toMatchObject({
      p_org: ORG, p_category: "lead_new", p_entity_type: "recruiting_leads", p_entity_id: LEAD, p_dedupe_key: `lead_new:${LEAD}`,
    });
  });

  it("a recipient lookup that fails does not reach the ingest", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    holder.managers.mockRejectedValue(new Error("access tables down"));
    await expect(ringNewLead(rec.client as never, ORG, LEAD, async () => [])).resolves.toBeUndefined();
    await expect(ringNewLead(rec.client as never, ORG, LEAD, async () => { throw new Error("settings down"); })).resolves.toBeUndefined();
    expect(rung()).toEqual([]);
    expect(quiet.mock.calls.map((c) => String(c[0]))).toEqual([expect.stringContaining(LEAD), expect.stringContaining(LEAD)]);
    quiet.mockRestore();
  });

  it("nobody to tell is said out loud, never silent", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    holder.managers.mockResolvedValue([]);
    await ringNewLead(rec.client as never, ORG, LEAD, async () => []);
    expect(String(quiet.mock.calls[0]?.[0])).toContain("nobody to tell");
    quiet.mockRestore();
  });
});
