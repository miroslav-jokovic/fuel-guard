import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { readLeadQuality } from "./leadQuality.js";

/** Recruiting's `LeadQuality` (LQ3b): what each count is, from the leads, their contacts and their newest verdicts. */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const C1 = "00000000-0000-4000-8000-00000000aa01";
const C2 = "00000000-0000-4000-8000-00000000aa02";
const L = (n: number) => `50000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const lead = (n: number, campaign: string, at = "2026-11-10T15:00:00Z") => ({ org_id: ORG, id: L(n), campaign_ref: campaign, received_at: at });
const contact = (n: number, outcome: string | null, at: string) => ({ org_id: ORG, id: `k${n}${at}`, lead_id: L(n), outcome, contacted_at: at });
const verdict = (n: number, requirement: string, v: string, hard: boolean, at: string) =>
  ({ org_id: ORG, lead_id: L(n), requirement, verdict: v, evidence: v === "unknown" ? null : "self_reported", detail: { hard }, computed_at: at });

const NO_CLOSED = { not_interested: 0, unreachable: 0, wrong_number: 0, duplicate: 0, out_of_area: 0, spam: 0 };
const act = (n: number, seq: number, kind: string, reason: string | null = null) => ({ org_id: ORG, id: `a${n}-${seq}`, lead_id: L(n), kind, reason, seq });

function seed(closures: Array<Record<string, unknown>> = []) {
  return createSupabaseRecorder({
    tables: {
      recruiting_leads: postgrestFixture([lead(1, C1), lead(2, C1), lead(3, C1), lead(4, C2)]),
      recruiting_contacts: postgrestFixture([
        contact(1, "no_answer", "2026-11-10T15:04:00Z"), contact(1, "wrong_number", "2026-11-10T16:00:00Z"),
        contact(2, "reached", "2026-11-10T15:10:00Z"),
        contact(4, "voicemail", "2026-11-10T15:30:00Z"),
      ]),
      lead_match_verdicts: postgrestFixture([
        verdict(1, "class_a", "does_not_meet", true, "2026-11-10T15:00:01Z"),
        // Lead 2's newest class_a verdict is `meets`; its older does_not_meet must not count.
        verdict(2, "class_a", "meets", true, "2026-11-11T09:00:00Z"), verdict(2, "class_a", "does_not_meet", true, "2026-11-10T15:00:01Z"),
        // Unknown is the next question, never a failure; a preference that is not met is not a HARD miss.
        verdict(3, "age", "unknown", true, "2026-11-10T15:00:01Z"), verdict(3, "hazmat", "does_not_meet", false, "2026-11-10T15:00:01Z"),
      ]),
      recruiting_lead_closures: postgrestFixture(closures),
    },
  });
}

describe("readLeadQuality (LQ3b)", () => {
  it("counts per campaign: attempted, wrong numbers, reached, hard does-not-meet on the newest verdict, minutes to first call", async () => {
    const rec = seed();
    const rows = await readLeadQuality(rec.client as never, ORG, "2026-11-06T00:00:00Z");
    expect(rows.find((r) => r.campaign_id === C1)).toEqual({
      campaign_id: C1, leads: 3, attempted: 2, wrong_number: 1, reached: 1, not_qualified: 1, median_first_attempt_minutes: 7, closed: NO_CLOSED,
    });
    expect(rows.find((r) => r.campaign_id === C2)).toEqual({
      campaign_id: C2, leads: 1, attempted: 1, wrong_number: 0, reached: 0, not_qualified: 0, median_first_attempt_minutes: 30, closed: NO_CLOSED,
    });
    expectOrgScoped(rec, ORG);
  });

  it("closed for another reason is the lead's NEWEST act, by reason, per campaign; every reason is in the answer (LR4)", async () => {
    // Rows handed over out of `seq` order on purpose: the reader's order is what makes "newest" true.
    const rec = seed([
      act(1, 12, "reopened"), act(1, 11, "closed", "out_of_area"),                   // closed, then reopened: open
      act(2, 22, "closed", "spam"), act(2, 21, "closed", "not_interested"),          // closed twice: the later reason, once
      act(3, 31, "closed", "not_qualified:class_a"),                                 // a requirement: that is not_qualified's
      act(4, 41, "closed", "out_of_area"),
      { org_id: "99999999-0000-4000-8000-000000000001", id: "other", lead_id: L(4), kind: "closed", reason: "spam", seq: 99 },
    ]);
    const rows = await readLeadQuality(rec.client as never, ORG, "2026-11-06T00:00:00Z");
    expect(rows.find((r) => r.campaign_id === C1)!.closed).toEqual({ ...NO_CLOSED, spam: 1 });
    expect(rows.find((r) => r.campaign_id === C2)!.closed).toEqual({ ...NO_CLOSED, out_of_area: 1 });
    expectOrgScoped(rec, ORG);
  });

  it("asks only ad leads (a campaign set) that arrived in the window", async () => {
    const rec = seed();
    await readLeadQuality(rec.client as never, ORG, "2026-11-06T00:00:00Z");
    const q = rec.queries.find((x) => x.table === "recruiting_leads")!;
    expect(q.ops.some((o) => o.method === "not" && o.args[0] === "campaign_ref" && o.args[1] === "is" && o.args[2] === null)).toBe(true);
    expect(q.ops.some((o) => o.method === "gte" && o.args[0] === "received_at" && o.args[1] === "2026-11-06T00:00:00Z")).toBe(true);
  });

  it("no lead in the window reads nothing else", async () => {
    const rec = createSupabaseRecorder({ tables: { recruiting_leads: [] } });
    expect(await readLeadQuality(rec.client as never, ORG, "2026-11-06T00:00:00Z")).toEqual([]);
    expect(rec.queries.map((q) => q.table)).toEqual(["recruiting_leads"]);
  });
});
