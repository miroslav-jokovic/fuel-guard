import { beforeEach, describe, expect, it, vi } from "vitest";
import { HIRING_PROFILE_V1, type PlatformLead } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { assignFromOpening } from "./leadAssignment.js";
import { recruitingLeadSink } from "./leadSink.js";

/**
 * A new ad lead's owner (LQ2b; 0574; Q-AD50 (a)): the opening's recruiter, asked of the access matrix when the
 * lead arrives, and the `lead_new` ring going to that one person. The matrix's own answer is `sectionManagers`'
 * test (`accessReview.test.ts`); here it is the mock.
 */

const holder = vi.hoisted(() => ({ managers: vi.fn() }));
vi.mock("../../org/index.js", () => ({ sectionManagerIds: holder.managers }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const LEAD = "50000000-0000-4000-8000-000000000001";
const OPENING = "60000000-0000-4000-8000-000000000001";
const PV = "70000000-0000-4000-8000-000000000001";
const DANA = "u-dana";

function seed(over: { recruiter?: string | null; owned?: boolean; openingsDown?: boolean } = {}): SupabaseRecorder {
  return createSupabaseRecorder({
    tables: {
      recruiting_openings: over.openingsDown
        ? () => ({ error: { message: "openings down" } })
        : postgrestFixture([{ org_id: ORG, id: OPENING, recruiter_id: over.recruiter === undefined ? DANA : over.recruiter }]),
      recruiting_leads: (q: RecordedQuery) => (q.write?.method === "update" ? { data: over.owned ? [] : [{ assigned_to: (q.write.payload as { assigned_to: string }).assigned_to }] } : []),
      recruiting_opening_versions: postgrestFixture([{ org_id: ORG, opening_id: OPENING, version: 2, profile_version_id: PV }]),
      hiring_profile_versions: postgrestFixture([{ org_id: ORG, id: PV, requirements: HIRING_PROFILE_V1 }]),
      lead_match_verdicts: (q: RecordedQuery) => (q.write?.method === "insert" ? { data: q.write.payload } : []),
      driver_app_features: [],
    },
    rpc: (fn) => (fn === "ingest_lead" ? { lead_id: LEAD, stored: "new", matches: { leads: [], drivers: [] } } : fn === "emit_notification" ? "note-1" : null),
  });
}
const leadWrite = (rec: SupabaseRecorder) => rec.writes().find((w) => w.table === "recruiting_leads");

beforeEach(() => {
  holder.managers.mockReset().mockResolvedValue([DANA, "u-sam"]);
});

describe("assignFromOpening (LQ2b)", () => {
  it("a lead for an opening that names a recruiter is that recruiter's, written only onto an unowned lead of this carrier", async () => {
    const rec = seed();
    expect(await assignFromOpening(rec.client as never, ORG, LEAD, OPENING)).toBe(DANA);
    const w = leadWrite(rec)!;
    expect(w.write!.payload).toEqual({ assigned_to: DANA });
    expect(w.filters()).toEqual(expect.arrayContaining([{ col: "id", val: LEAD }, { col: "assigned_to", val: null }]));
    // `filters()` drops the operator, so the null filter is pinned as an IS, not an eq that would match nothing.
    expect(w.ops.some((o) => o.method === "is" && o.args[0] === "assigned_to" && o.args[1] === null)).toBe(true);
    expectOrgScoped(rec, ORG);
  });

  it("a recruiter who no longer holds recruitment manage is not assigned, though the opening still names them", async () => {
    holder.managers.mockResolvedValue(["u-sam"]);
    const rec = seed();
    expect(await assignFromOpening(rec.client as never, ORG, LEAD, OPENING)).toBeNull();
    expect(leadWrite(rec)).toBeUndefined();
  });

  it("an opening with no recruiter leaves the lead everybody's, without asking the access matrix", async () => {
    const rec = seed({ recruiter: null });
    expect(await assignFromOpening(rec.client as never, ORG, LEAD, OPENING)).toBeNull();
    expect([leadWrite(rec), holder.managers.mock.calls.length]).toEqual([undefined, 0]);
  });

  it("a lead with no opening reads nothing and owns nobody", async () => {
    const rec = seed();
    expect(await assignFromOpening(rec.client as never, ORG, LEAD, null)).toBeNull();
    expect(rec.queries.length).toBe(0);
  });

  it("a lead somebody already owns is never taken back", async () => {
    const rec = seed({ owned: true });
    expect(await assignFromOpening(rec.client as never, ORG, LEAD, OPENING)).toBeNull();
  });
});

function metaLead(): PlatformLead {
  return {
    provider: "meta", platform_lead_ref: "777", campaign_id: "00000000-0000-4000-8000-00000000aa01", brief_source: "recruiting_opening",
    brief_ref: `${OPENING}@v2`, created_at: "2026-11-04T14:00:00+00:00", answers: { full_name: "Ray Driver", phone_number: "+13125550100" },
    raw: { id: "777", field_data: [] },
  };
}
const rung = (rec: SupabaseRecorder) => rec.rpcs().filter((c) => c.fn === "emit_notification").map((c) => c.args as { p_user: string; p_title: string });
const accept = (rec: SupabaseRecorder) => recruitingLeadSink(rec.client as never, async () => ["u-list"], () => new Date("2026-11-04T15:00:00Z")).accept(ORG, metaLead());

describe("the sink rings the owner (LQ2b)", () => {
  it("a new ad lead for an owned opening rings only its recruiter, in words that say it is theirs", async () => {
    const rec = seed();
    expect((await accept(rec)).stored).toBe("new");
    expect(rung(rec).map((r) => [r.p_user, r.p_title])).toEqual([[DANA, "New lead for your opening"]]);
  });

  it("an opening with no recruiter rings the carrier's list, as before", async () => {
    const rec = seed({ recruiter: null });
    await accept(rec);
    expect(rung(rec).map((r) => r.p_user)).toEqual(["u-list"]);
  });

  it("an assignment that fails never fails the accept: the lead is stored and rings everybody", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const rec = seed({ openingsDown: true });
    expect((await accept(rec)).stored).toBe("new");
    expect(rung(rec).map((r) => r.p_user)).toEqual(["u-list"]);
    expect(quiet.mock.calls.some((c) => String(c[0]).includes("[lead-assign]"))).toBe(true);
    quiet.mockRestore();
  });
});
