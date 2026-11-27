import { describe, expect, it } from "vitest";
import { ALERT_TEXT_QUIET_DEFAULT } from "@silvicom/shared";
import { buildBrokerMailWeek, type WeekInput, type WeekMessage } from "./brokerMailWeek.js";

/** The measure week's report (§8) — each line's rule, on rows whose answer is known by hand. */
const IVO = "00000000-0000-4000-8000-000000000031";
const ASEN = "00000000-0000-4000-8000-000000000032";
const LOAD = "00000000-0000-4000-8000-0000000000c1";
const ZONE = "America/Chicago";
let seq = 0;

function msg(over: Partial<WeekMessage>): WeekMessage {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    owner_user_id: IVO,
    received_at: "2026-11-24T16:00:00Z", // 10:00 AM in Chicago
    from_address: "anna@chrobinson.com",
    from_domain: "chrobinson.com",
    conversation_id: `conv-${seq}`,
    subject: "RE: 48213 ETA?",
    addressed_directly: true,
    was_candidate: true,
    body_was_read: false,
    matched_refs: ["48213"],
    match_state: "one",
    load_id: LOAD,
    thread_state: "waiting",
    answered_at: null,
    ...over,
  };
}

function week(messages: WeekMessage[], over: Partial<WeekInput> = {}) {
  return buildBrokerMailWeek({
    from: "2026-11-24", to: "2026-11-30", zone: ZONE,
    nowMs: Date.parse("2026-11-27T18:00:00Z"),
    quiet: ALERT_TEXT_QUIET_DEFAULT, // 9 PM – 7 AM
    answerWithinMinutes: 20, backupAfterMinutes: 5,
    messages, cycles: [],
    names: new Map([[IVO, "Ivo"], [ASEN, "Asen"]]),
    loads: new Map([[LOAD, { ref: "48213", dispatcherUserId: IVO }]]),
    ...over,
  });
}

describe("buildBrokerMailWeek — the §8 lines", () => {
  it("replays the texts: answered in time sends nothing; late sends the dispatcher's, then the backup's", () => {
    const r = week([
      msg({ thread_state: "answered_by_owner", answered_at: "2026-11-24T16:10:00Z" }), // 10 min: nothing
      msg({ thread_state: "answered_by_owner", answered_at: "2026-11-24T16:22:00Z" }), // 22 min: dispatcher only
      msg({}), // never answered: both
    ]).total;
    expect(r.wouldText).toEqual({ dispatcherDay: 2, dispatcherNight: 0, backupDay: 1, backupHeldToMorning: 0 });
    expect(r.replyMinutesMedian).toBe(10);
    expect(r.answeredByOwner).toBe(2);
    expect(r.stillWaiting).toBe(1);
  });

  it("at night the dispatcher is texted; the backup waits for 7 AM and only if still unanswered then", () => {
    const night = "2026-11-25T04:00:00Z"; // 10:00 PM in Chicago
    const r = week([
      msg({ received_at: night }), // never answered: held notice goes at 7 AM
      msg({ received_at: night, thread_state: "answered_by_owner", answered_at: "2026-11-25T08:00:00Z" }), // answered 2 AM: no notice
    ]).total;
    expect(r.wouldText).toEqual({ dispatcherDay: 0, dispatcherNight: 2, backupDay: 0, backupHeldToMorning: 1 });
  });

  it("only the page's open queues text: a non-candidate with no load never does", () => {
    const r = week([msg({ was_candidate: false, match_state: "not_tried", matched_refs: [], load_id: null, subject: "Newsletter" })]).total;
    expect(r.wouldText.dispatcherDay).toBe(0);
    expect(r.match.not_tried).toBe(1);
  });

  it("tells a subject match from a body match, and whether the load is the mailbox owner's", () => {
    const r = week([
      msg({}), // 48213 is in the subject
      msg({ subject: "Status please", body_was_read: true }), // matched only through the body
      msg({ owner_user_id: ASEN }), // Ivo's load, in Asen's Outlook (covering)
    ]).total;
    expect(r.match.one).toBe(3);
    expect(r.oneBySubject).toBe(2);
    expect(r.oneOwnersLoad).toBe(2);
    expect(r.bodiesRead).toBe(1);
  });

  it("counts a broker's follow-up that Outlook put on a new conversation", () => {
    const r = week([msg({ conversation_id: "a" }), msg({ conversation_id: "b" }), msg({ conversation_id: "b" })]).total;
    expect(r.followUpNewConversation).toBe(1);
  });

  it("gives the first pass mark over the broker candidates, and lists domains that sent no reference", () => {
    const r = week([
      msg({}), msg({}),
      msg({ match_state: "none", load_id: null, matched_refs: [] }),
      msg({ was_candidate: false, match_state: "not_tried", load_id: null, matched_refs: [], from_domain: "vendor.com", subject: "Invoice" }),
    ]);
    expect(r.passMarks.matchedOneShare).toBeCloseTo(2 / 3);
    expect(r.passMarks.matchedOnePass).toBe(false);
    expect(r.noReferenceDomains).toEqual([{ domain: "vendor.com", emails: 1 }]);
  });

  it("splits by the company's day and by mailbox, and says when run counts are gone", () => {
    const r = week([msg({}), msg({ received_at: "2026-11-26T05:30:00Z", owner_user_id: ASEN })], { cycles: null });
    expect(r.days.map((d) => d.stats.external)).toEqual([1, 1, 0, 0, 0, 0, 0]); // 05:30 UTC on the 26th is 11:30 PM on the 25th in Chicago
    expect(r.days[0]!.runs).toBeNull();
    expect(r.runCountsKept).toBe(false);
    expect(r.mailboxes.map((m) => [m.name, m.stats.external])).toEqual([["Asen", 1], ["Ivo", 1]]);
  });

  it("sums the gateway's runs per day against one a minute", () => {
    const r = week([], { cycles: [
      { started_at: "2026-11-24T16:00:00Z", counts: { messages_in: 4, bodies_read: 1, graph_throttled: 0, errors: 1 } },
      { started_at: "2026-11-24T16:01:00Z", counts: { messages_in: 2 } },
    ] });
    expect(r.days[0]!.runs).toEqual({ runs: 2, runsExpected: 1440, messagesRead: 6, bodiesRead: 1, throttled: 0, errors: 1 });
    expect(r.days[6]!.runs!.runsExpected).toBe(0); // the 30th has not started
  });

  it("picks the same hand-check sample every time for the same range, at most 50", () => {
    const rows = Array.from({ length: 80 }, () => msg({}));
    const a = week(rows).sample.map((s) => s.id);
    expect(a).toHaveLength(50);
    expect(week([...rows].reverse()).sample.map((s) => s.id)).toEqual(a);
  });
});
