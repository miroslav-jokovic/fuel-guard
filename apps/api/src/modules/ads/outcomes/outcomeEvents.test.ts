import { describe, expect, it } from "vitest";
import { UNRECORDED_LEAD_STAGES, type LeadOutcome } from "@silvicom/shared";
import { CAPI_MAX_AGE_MS, capiEvent, outcomeCandidates, tooOldToSend } from "./outcomeEvents.js";

const LEAD = "00000000-0000-4000-8000-000000000001";
const CAMP = "00000000-0000-4000-8000-0000000000e1";
const base: LeadOutcome = {
  lead_id: LEAD, provider: "meta", platform_lead_ref: "120000000000001", campaign_id: CAMP,
  arrived_at: "2026-11-01T15:00:00.000Z", reached: {},
};

describe("outcome events — the pure half of B6", () => {
  it("one candidate per recorded stage, its ref the lead id and the stage, in the shared stage order", () => {
    const c = outcomeCandidates([{ ...base, reached: { hired: "2026-11-05T05:00:00.000Z", contacted: "2026-11-01T16:00:00.000Z" } }]);
    expect(c.map((x) => [x.source_event_ref, x.stage, x.platform_lead_ref, x.campaign_id])).toEqual([
      [`${LEAD}:contacted`, "contacted", "120000000000001", CAMP],
      [`${LEAD}:hired`, "hired", "120000000000001", CAMP],
    ]);
  });

  it("no unrecorded stage can become a candidate (Q-AD37: never sent)", () => {
    const reached = Object.fromEntries(UNRECORDED_LEAD_STAGES.map((s) => [s, "2026-11-02T00:00:00.000Z"]));
    expect(outcomeCandidates([{ ...base, reached: reached as LeadOutcome["reached"] }])).toEqual([]);
  });

  it("a stage stamped before the lead arrived is sent at the lead's arrival (Meta may discard an earlier one)", () => {
    const [c] = outcomeCandidates([{ ...base, reached: { contacted: "2026-11-01T14:00:00.000Z" } }]);
    expect(c!.event_time).toBe("2026-11-01T15:00:00.000Z");
  });

  it("a campaign ref that is not one of our record ids is not cited", () => {
    expect(outcomeCandidates([{ ...base, campaign_id: "meta-campaign-name", reached: { contacted: base.arrived_at } }])[0]!.campaign_id).toBeNull();
  });

  it("only a Meta lead is a Meta candidate", () => {
    expect(outcomeCandidates([{ ...base, provider: "simulator", reached: { contacted: base.arrived_at } }])).toEqual([]);
  });

  it("seven days old is still sent; a millisecond more is too old", () => {
    const now = new Date("2026-11-08T15:00:00.000Z");
    expect(tooOldToSend(new Date(now.getTime() - CAPI_MAX_AGE_MS).toISOString(), now)).toBe(false);
    expect(tooOldToSend(new Date(now.getTime() - CAPI_MAX_AGE_MS - 1).toISOString(), now)).toBe(true);
  });

  it("the Conversions API event is a CRM event in seconds, the lead id a string", () => {
    expect(capiEvent({ source_event_ref: `${LEAD}:applied`, platform_lead_ref: "12345678901234567", stage: "applied", event_time: "2026-11-02T00:00:01.900Z" })).toEqual({
      event_name: "applied", event_time: 1793577601, event_id: `${LEAD}:applied`, action_source: "system_generated",
      user_data: { lead_id: "12345678901234567" }, custom_data: { event_source: "crm", lead_event_source: "Silvicom 360" },
    });
  });
});
