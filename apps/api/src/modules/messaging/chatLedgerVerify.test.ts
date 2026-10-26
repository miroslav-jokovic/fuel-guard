import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";

/**
 * The nightly chat ledger check (OFFICE-CHAT-PLAN CHA1). What it can get wrong: stay silent on a
 * broken chain, call an unreadable chain intact, tell somebody other than the admins, alert more than
 * once a day per org, run at a time other than 05:00 Central — or, since CHA4, trust a chain whose
 * anchored link has moved, or anchor a head that did not verify.
 */

const sent: Array<{ orgId: string; userId: string; category: string; severity?: string; title: string; body?: string; dedupeKey?: string }> = [];
vi.mock("./notify.js", () => ({
  notify: vi.fn(async (_admin: unknown, input: (typeof sent)[number]) => {
    sent.push(input);
    return `n-${sent.length}`;
  }),
}));

const { chatLedgerAlert, chatLedgerVerifyDueDay, describeAnchor, runChatLedgerVerifyOnce } = await import("./chatLedgerVerify.js");

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
const recorder = (rpc: unknown, ledger: unknown[] = []) =>
  createSupabaseRecorder({
    rpc: { chat_ledger_verify: rpc, chat_people: people },
    // `chat_ledger` answers the head read (highest seq first) and the anchored-link read (one seq).
    tables: {
      chat_ledger: (q) => {
        const seq = q.filters().find((f) => f.col === "seq")?.val;
        const rows = ledger as Array<{ seq: number; hash: string }>;
        return seq === undefined ? [...rows].sort((a, b) => b.seq - a.seq) : rows.filter((r) => r.seq === Number(seq));
      },
    },
  });

const H = (c: string) => c.repeat(64);
function memoryAnchors(initial: string[] = []) {
  const objects = new Map<string, string>(initial.map((k) => [k, "{}"]));
  return {
    objects,
    async inventory(prefix: string) {
      const m = new Map<string, unknown>();
      for (const k of objects.keys()) if (k.startsWith(prefix)) m.set(k, {});
      return m;
    },
    async put(key: string, body: Uint8Array) {
      objects.set(key, new TextDecoder().decode(body));
    },
  };
}

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

describe("the anchor (CHA4)", () => {
  const ledger = [{ seq: 1, hash: H("1") }, { seq: 2, hash: H("2") }, { seq: 3, hash: H("3") }];

  it("without a store it self-checks only, and says so", async () => {
    const rec = recorder([verdictRow({ checked: 3 })]);
    const r = await runChatLedgerVerifyOnce(rec.client, ORG, DAY, null);
    expect(r.anchor).toEqual({ state: "off" });
    expect(describeAnchor(r.anchor)).toContain("chain self-checked only");
    expect(rec.forTable("chat_ledger")).toHaveLength(0);
  });

  it("writes the first anchor at the head once the chain verifies, naming the day", async () => {
    const rec = recorder([verdictRow({ checked: 3 })], ledger);
    const store = memoryAnchors();
    const r = await runChatLedgerVerifyOnce(rec.client, ORG, DAY, store);
    expect(r.anchor).toEqual({ state: "first", wrote: { day: DAY, seq: 3, hash: H("3") } });
    expect([...store.objects.keys()]).toEqual([`chat-ledger-anchors/${ORG}/${DAY}-000000000003-${H("3")}.json`]);
    expect(sent).toEqual([]);
    expectOrgScoped(rec, ORG);
  });

  it("holds yesterday's anchor against tonight's ledger and anchors the new head", async () => {
    const rec = recorder([verdictRow({ checked: 3 })], ledger);
    const store = memoryAnchors([`chat-ledger-anchors/${ORG}/2026-10-23-000000000002-${H("2")}.json`]);
    const r = await runChatLedgerVerifyOnce(rec.client, ORG, DAY, store);
    expect(r.problem).toBeNull();
    expect(r.anchor).toEqual({
      state: "checked",
      against: { day: "2026-10-23", seq: 2, hash: H("2") },
      wrote: { day: DAY, seq: 3, hash: H("3") },
    });
    expect(describeAnchor(r.anchor)).toBe("anchor from 2026-10-23 (seq 2) holds; anchored tonight at seq 3");
    expect(store.objects.size).toBe(2);
    // The link read asks for the anchored seq within the org.
    const link = rec.forTable("chat_ledger").find((q) => q.filters().some((f) => f.col === "seq"))!;
    expect(link.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "seq", val: 2 }]));
  });

  it("names a tail cut off below the anchor, alerts, and leaves last night's anchor standing", async () => {
    const rec = recorder([verdictRow({ checked: 1 })], [{ seq: 1, hash: H("1") }]);
    const key = `chat-ledger-anchors/${ORG}/2026-10-23-000000000003-${H("3")}.json`;
    const store = memoryAnchors([key]);
    const r = await runChatLedgerVerifyOnce(rec.client, ORG, DAY, store);
    expect(r).toMatchObject({ problem: "ledger truncated below its anchor", firstBadSeq: 3, notified: 2 });
    expect(r.anchor).toEqual({ state: "skipped", why: "the chain did not verify, so last night's anchor stands" });
    expect([...store.objects.keys()]).toEqual([key]);
    expect(sent[0]!.body).toContain("ledger truncated below its anchor (ledger entry 3)");
  });

  it("names an anchored entry that was rewritten, even though the chain recomputed cleanly", async () => {
    const rewritten = [{ seq: 1, hash: H("1") }, { seq: 2, hash: H("x") }, { seq: 3, hash: H("y") }];
    const rec = recorder([verdictRow({ checked: 3 })], rewritten);
    const store = memoryAnchors([`chat-ledger-anchors/${ORG}/2026-10-23-000000000002-${H("2")}.json`]);
    const r = await runChatLedgerVerifyOnce(rec.client, ORG, DAY, store);
    expect(r.problem).toBe("anchored ledger entry altered");
    expect(r.notified).toBe(2);
    expect(store.objects.size).toBe(1);
  });

  it("reports the chain's own problem first, and still writes no anchor", async () => {
    const rec = recorder([verdictRow({ checked: 1, first_bad_seq: "2", problem: "ledger row altered" })], ledger);
    const store = memoryAnchors([`chat-ledger-anchors/${ORG}/2026-10-23-000000000002-${H("2")}.json`]);
    const r = await runChatLedgerVerifyOnce(rec.client, ORG, DAY, store);
    expect(r.problem).toBe("ledger row altered");
    expect(r.anchor.state).toBe("skipped");
    expect(store.objects.size).toBe(1);
  });

  it("anchors nothing for an empty ledger, and does not call that a problem", async () => {
    const rec = recorder([verdictRow({ checked: 0 })], []);
    const store = memoryAnchors();
    const r = await runChatLedgerVerifyOnce(rec.client, ORG, DAY, store);
    expect(r.anchor).toEqual({ state: "first", wrote: null });
    expect(describeAnchor(r.anchor)).toBe("ledger empty, nothing to anchor yet");
    expect(store.objects.size).toBe(0);
  });

  it("treats an unreadable head as an unread chain", async () => {
    const rec = createSupabaseRecorder({ rpc: { chat_ledger_verify: [verdictRow()] }, tables: { chat_ledger: { error: { message: "timeout" } } } });
    await expect(runChatLedgerVerifyOnce(rec.client, ORG, DAY, memoryAnchors())).rejects.toThrow("chat_ledger head: timeout");
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
