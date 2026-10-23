import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";

/**
 * The nightly chat ledger check (OFFICE-CHAT-PLAN CHA1). What it can get wrong: stay silent on a
 * broken chain, call an unreadable chain intact, tell somebody other than the admins, alert more than
 * once a day per org, or run at a time other than 05:00 Central.
 */

const sent: Array<{ orgId: string; userId: string; category: string; severity?: string; title: string; body?: string; dedupeKey?: string }> = [];
vi.mock("./notify.js", () => ({
  notify: vi.fn(async (_admin: unknown, input: (typeof sent)[number]) => {
    sent.push(input);
    return `n-${sent.length}`;
  }),
}));

const { chatLedgerAlert, chatLedgerVerifyDueDay, runChatLedgerVerifyOnce } = await import("./chatLedgerVerify.js");

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const MSG = "11111111-1111-4111-8111-111111111111";
const DAY = "2026-10-24";

const verdictRow = (o: Record<string, unknown> = {}) => ({ checked: 12, first_bad_seq: null, problem: null, message_id: null, ...o });
const A1 = "22222222-2222-4222-8222-222222222222";
const A2 = "33333333-3333-4333-8333-333333333333";
// The org's office people as `chat_people` lists them: two admins, a dispatcher and a safety manager.
const people = [
  { user_id: A1, name: "Ana Admin", role: "admin" },
  { user_id: "44444444-4444-4444-8444-444444444444", name: "Dan Dispatch", role: "dispatcher" },
  { user_id: A2, name: "Bo Admin", role: "admin" },
  { user_id: "55555555-5555-4555-8555-555555555555", name: "Sam Safety", role: "safety_manager" },
];
const recorder = (rpc: unknown) => createSupabaseRecorder({ rpc: { chat_ledger_verify: rpc, chat_people: people } });

beforeEach(() => {
  sent.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the nightly chat ledger check", () => {
  it("asks for the org's whole chain, and says nothing when it is intact", async () => {
    const rec = recorder([verdictRow()]);
    const r = await runChatLedgerVerifyOnce(rec.client, ORG, DAY);
    expect(r).toMatchObject({ checked: 12, problem: null, notified: 0 });
    expect(rec.rpcs()).toEqual([{ fn: "chat_ledger_verify", args: { p_org: ORG, p_after_seq: 0 } }]);
    expect(sent).toEqual([]);
    expectOrgScoped(rec, ORG);
  });

  it("tells every admin, critically, once per org per day, when the chain is broken", async () => {
    const rec = recorder([verdictRow({ checked: 41, first_bad_seq: "42", problem: "ledger row altered", message_id: MSG })]);
    const r = await runChatLedgerVerifyOnce(rec.client, ORG, DAY);
    expect(r).toMatchObject({ firstBadSeq: 42, problem: "ledger row altered", notified: 2 });
    expect(sent.map((n) => [n.userId, n.category, n.severity, n.dedupeKey])).toEqual([
      [A1, "system", "critical", `chat_ledger:${ORG}:${DAY}`],
      [A2, "system", "critical", `chat_ledger:${ORG}:${DAY}`],
    ]);
    expect(rec.rpcs().map((r) => r.args)).toEqual([{ p_org: ORG, p_after_seq: 0 }, { p_org: ORG }]);
    expect(sent[0]!.body).toContain("ledger row altered (ledger entry 42, message 11111111-1111-4111-8111-111111111111)");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`[chat-ledger] org ${ORG}: ledger row altered`));
  });

  it("reports a message whose text no longer matches, even though the chain itself checked out", async () => {
    const rec = recorder([verdictRow({ problem: "message text differs from the ledger", message_id: MSG })]);
    await runChatLedgerVerifyOnce(rec.client, ORG, DAY);
    expect(sent).toHaveLength(2);
    expect(sent[0]!.body).toContain("message text differs from the ledger (message 11111111-1111-4111-8111-111111111111)");
  });

  it("alerts on a problem found before any entry checked out — a message the ledger never recorded", async () => {
    const rec = recorder([verdictRow({ checked: "0", problem: "message has no ledger entry", message_id: MSG })]);
    expect(await runChatLedgerVerifyOnce(rec.client, ORG, DAY)).toMatchObject({ checked: 0, notified: 2 });
    expect(sent[0]!.body).toContain("message has no ledger entry");
  });

  it("never calls a chain it could not read intact", async () => {
    await expect(runChatLedgerVerifyOnce(recorder({ error: { message: "timeout" } }).client, ORG, DAY))
      .rejects.toThrow("chat_ledger_verify: timeout");
    await expect(runChatLedgerVerifyOnce(recorder([]).client, ORG, DAY)).rejects.toThrow("returned no row");
    expect(sent).toEqual([]);
  });

  it("has nothing to say about an intact verdict", () => {
    expect(chatLedgerAlert(ORG, { checked: 3, firstBadSeq: null, problem: null, messageId: null }, DAY)).toBeNull();
  });
});

describe("chatLedgerVerifyDueDay", () => {
  it("is due once in the 05:00 Central hour, and not again that day", () => {
    const at = (iso: string) => Date.parse(iso);
    expect(chatLedgerVerifyDueDay(at("2026-10-24T09:59:00Z"), null)).toBeNull(); // 04:59 CDT
    expect(chatLedgerVerifyDueDay(at("2026-10-24T10:00:00Z"), null)).toBe("2026-10-24"); // 05:00 CDT
    expect(chatLedgerVerifyDueDay(at("2026-10-24T10:45:00Z"), "2026-10-24")).toBeNull();
    expect(chatLedgerVerifyDueDay(at("2026-10-24T11:00:00Z"), null)).toBeNull(); // 06:00 CDT
    // After the clocks change it follows Central, not UTC: 05:00 CST is 11:00 UTC.
    expect(chatLedgerVerifyDueDay(at("2026-11-02T11:00:00Z"), "2026-11-01")).toBe("2026-11-02");
  });
});
