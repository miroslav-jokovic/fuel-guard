import { beforeEach, describe, expect, it, vi } from "vitest";
import { draftFactCheck, type BrokerMailLoadFacts } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../testing/supabaseRecorder.js";
import type { MessagesClient } from "../../lib/anthropic.js";

/**
 * Broker mail P4 in the API (D-BMR11): only the mailbox's owner composes, queues or closes; the model is
 * given the load's facts and never the email; a draft naming a number the facts lack is refused; every
 * call is on the cost ledger; every query is org-scoped.
 */
const ORG = "00000000-0000-4000-8000-0000000000aa";
const IVO = "00000000-0000-4000-8000-000000000031";
const ASEN = "00000000-0000-4000-8000-000000000032";
const MSG = "00000000-0000-4000-8000-0000000000d1";
const LOAD = "00000000-0000-4000-8000-0000000000c1";

const FACTS: BrokerMailLoadFacts = {
  loadRef: "48213", customerName: "CH Robinson", status: "In transit", inMcleod: true, accepted: true,
  truckUnit: "412", trailerUnit: "53-2210", location: { place: "Joliet, IL", ageMinutes: 4 },
  nextStop: { kind: "delivery", city: "Dallas", state: "TX", appointment: "11/27/2026 3:00 PM", arrived: false },
  eta: { at: "11/27/2026 2:30 PM", computedAt: "2026-11-27T16:00:00Z" }, milesToNextStop: 86, onTime: "on_time",
};
vi.mock("../livemap/index.js", () => ({ readLoadStatusFacts: async () => new Map([[LOAD, FACTS]]) }));
let modelText = "Hi, truck 412 is 86 miles from Dallas, TX, ETA 2:30 PM. Thanks, Ivo";
const sent: unknown[] = [];
vi.mock("../../lib/anthropic.js", async (orig) => ({
  ...(await orig<typeof import("../../lib/anthropic.js")>()),
  callForcedTool: async (_c: unknown, req: unknown) => {
    sent.push(req);
    return { kind: "ok", value: { text: modelText, facts_used: ["truck", "miles_left", "eta", "next_stop", "trailer"] }, usage: { input: 900, output: 80 }, requestId: "r" };
  },
}));

const { composeBrokerMailDraft, queueBrokerMailDraft, closeBrokerMail, readBrokerMailDetail } = await import("./brokerMailDraft.js");
const AI = { client: {} as MessagesClient, model: "claude-haiku-5-5" };
let rec: SupabaseRecorder;
let threadState = "waiting";

beforeEach(() => {
  sent.length = 0;
  threadState = "waiting";
  modelText = "Hi, truck 412 is 86 miles from Dallas, TX, ETA 2:30 PM. Thanks, Ivo";
  rec = createSupabaseRecorder({
    tables: {
      broker_mail_messages: () => [{ id: MSG, org_id: ORG, owner_user_id: IVO, mailbox: "ivo@silvicominc.com", received_at: "2026-11-27T15:40:00Z",
        from_address: "anna@chrobinson.com", subject: "RE: 48213 ETA? (secret words)", thread_state: threadState, ask_kinds: ["eta"], load_id: LOAD }],
      broker_mail_drafts: (q) => (q.write ? [{ id: "00000000-0000-4000-8000-0000000000f1" }] : []),
      mail_gateway_config: [{ org_id: ORG, enabled: true }],
      loads: [{ id: LOAD, org_id: ORG, ref: "48213" }],
      organizations: [{ id: ORG, operating_hours: { tz: "America/Chicago" } }],
    },
    rpc: (fn: string) => (fn === "org_member_directory" ? [{ user_id: IVO, full_name: "Ivo Kovac", email: "ivo@silvicominc.com", role: "dispatcher" }] : null),
  });
});

describe("compose", () => {
  it("gives the model the load's facts and what is asked — never the email's subject, body or sender", async () => {
    const r = await composeBrokerMailDraft(rec.client, AI, ORG, IVO, MSG, new Date("2026-11-27T16:00:00Z"));
    expect(r.ok).toBe(true);
    const req = JSON.stringify(sent[0]);
    expect(req).toContain("86");
    expect(req).toContain("Ivo");
    expect(req).not.toMatch(/secret words|anna@|chrobinson\.com/);
    if (r.ok) expect(r.value.factsIncluded).toEqual(["truck", "miles_left", "eta", "next_stop", "trailer"]);
    const ledger = rec.rpcs().find((c) => c.fn === "broker_mail_record_compose");
    expect(ledger?.args).toMatchObject({ p_org: ORG, p_outcome: "drafted", p_input_tokens: 900, p_output_tokens: 80, p_yyyymm: "2026-11" });
    expect(JSON.stringify(ledger?.args)).not.toContain("truck 412");
    expectOrgScoped(rec, ORG);
  });

  it("refuses a draft that names a number the facts do not have, and says so on the ledger", async () => {
    modelText = "Hi, truck 412 will be there in 45 minutes. Thanks, Ivo";
    const r = await composeBrokerMailDraft(rec.client, AI, ORG, IVO, MSG);
    expect(r).toMatchObject({ ok: false, code: "draft_unchecked" });
    expect(rec.rpcs().find((c) => c.fn === "broker_mail_record_compose")?.args).toMatchObject({ p_outcome: "fact_check_refused" });
  });

  it("only the mailbox's owner may compose — an admin who sees all may not write in Ivo's name", async () => {
    expect(await composeBrokerMailDraft(rec.client, AI, ORG, ASEN, MSG)).toMatchObject({ ok: false, status: 403 });
    expect(sent).toHaveLength(0);
  });

  it("an answered email, or no model on the server, spends nothing", async () => {
    threadState = "answered_by_owner";
    expect(await composeBrokerMailDraft(rec.client, AI, ORG, IVO, MSG)).toMatchObject({ ok: false, status: 409 });
    threadState = "waiting";
    expect(await composeBrokerMailDraft(rec.client, { client: null, model: "m" }, ORG, IVO, MSG)).toMatchObject({ ok: false, status: 503 });
    expect(sent).toHaveLength(0);
  });
});

describe("queue and close", () => {
  it("queues the approved text for the owner's own mailbox; a changed text is `edited`", async () => {
    const r = await queueBrokerMailDraft(rec.client, ORG, IVO, MSG, { text: "Hi, all good. Thanks, Ivo", factsIncluded: ["status"], composedSha256: "0".repeat(64) });
    expect(r).toMatchObject({ ok: true, value: { composedBy: "edited" } });
    const row = rec.writtenRows("broker_mail_drafts")[0]!;
    expect(row).toMatchObject({ org_id: ORG, message_id: MSG, mailbox: "ivo@silvicominc.com", owner_user_id: IVO, draft_text: "Hi, all good. Thanks, Ivo", composed_by: "edited" });
    expect(await queueBrokerMailDraft(rec.client, ORG, ASEN, MSG, { text: "x", factsIncluded: [], composedSha256: null })).toMatchObject({ ok: false, status: 403 });
    expectOrgScoped(rec, ORG);
  });

  it("closes only the owner's own waiting email, naming who closed it", async () => {
    await closeBrokerMail(rec.client, ORG, IVO, MSG, "closed_by_phone", new Date("2026-11-27T16:00:00Z"));
    const upd = rec.forTable("broker_mail_messages").find((q) => q.write);
    expect(upd?.write?.payload).toMatchObject({ thread_state: "closed_by_phone", closed_by: IVO });
    expect(upd?.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "owner_user_id", val: IVO }, { col: "thread_state", val: "waiting" }]));
    expect(await closeBrokerMail(rec.client, ORG, ASEN, MSG, "closed_not_for_us")).toMatchObject({ ok: false, status: 403 });
  });

  it("the panel: a colleague without the switch is told it is not there; the owner may act", async () => {
    expect(await readBrokerMailDetail(rec.client, ORG, ASEN, false, MSG)).toMatchObject({ ok: false, status: 404 });
    const own = await readBrokerMailDetail(rec.client, ORG, IVO, false, MSG);
    expect(own).toMatchObject({ ok: true, value: { isOwner: true, draftsAvailable: true, askKinds: ["eta"], facts: { truckUnit: "412" } } });
    expect(await readBrokerMailDetail(rec.client, ORG, ASEN, true, MSG)).toMatchObject({ ok: true, value: { isOwner: false } });
  });
});

describe("draftFactCheck", () => {
  it("passes numbers and states the facts hold; refuses invented ones", () => {
    expect(draftFactCheck("Truck 412, trailer 53-2210, 86 miles from Dallas, TX.", FACTS)).toEqual({ ok: true });
    expect(draftFactCheck("ETA 2:30 PM on 11/27/2026.", FACTS)).toEqual({ ok: true });
    expect(draftFactCheck("About 90 miles out, in OK.", FACTS)).toEqual({ ok: false, unknown: ["90", "OK"] });
  });
});
