import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../testing/postgrestFixture.js";

/**
 * Broker mail's texts (BROKER-MAIL-READER-PLAN P3). The senders are messaging's, mocked here so the test
 * can say exactly which alert went to whom; messaging's own tests cover the road itself.
 */
const sent = vi.hoisted(() => ({ alerts: vi.fn(), drain: vi.fn() }));
vi.mock("../messaging/index.js", () => ({ sendAlerts: sent.alerts, drainAlertTexts: sent.drain }));
vi.mock("../org/index.js", () => ({
  orgTimezone: async () => "America/Chicago",
  listOfficeMembers: async () => [{ userId: OWNER, fullName: "Artur", email: "a@x.test", role: "dispatcher" }],
}));
const { dueAlerts, brokerMailDoor, runBrokerMailTextsOnce } = await import("./brokerMailTexts.js");

const ORG = "00000000-0000-4000-8000-0000000000aa";
const OWNER = "00000000-0000-4000-8000-000000000031";
const BACKUP = "00000000-0000-4000-8000-000000000032";
const NOW = new Date("2026-11-26T03:40:00Z"); // 21:40 Central
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const S = { answer_within_minutes: 20, backup_after_minutes: 5, texts_on_since: ago(600) };
const row = (o: Record<string, unknown> = {}) => ({
  id: "00000000-0000-4000-8000-0000000000d1", org_id: ORG, owner_user_id: OWNER, received_at: ago(21), from_address: "anna@chrobinson.com",
  from_domain: "chrobinson.com", match_state: "one", was_candidate: true, load_id: null, thread_state: "waiting",
  thread_checked_at: ago(1), owner_alerted_at: null, backup_alerted_at: null, ...o,
});

describe("which email is due which alert", () => {
  it("the dispatcher at the answer-by time, on a fresh check", () => {
    expect(dueAlerts([row()], S, NOW.getTime()).owner).toHaveLength(1);
    expect(dueAlerts([row({ received_at: ago(19) })], S, NOW.getTime()).owner).toHaveLength(0);
  });

  it("a stale check holds the dispatcher's alert up to 10 minutes, then sends it anyway (Q-BMR7)", () => {
    const stale = { thread_checked_at: ago(6) };
    expect(dueAlerts([row({ ...stale, received_at: ago(25) })], S, NOW.getTime())).toMatchObject({ owner: [], ownerLate: [], held: 1 });
    expect(dueAlerts([row({ ...stale, received_at: ago(31) })], S, NOW.getTime()).ownerLate).toHaveLength(1);
  });

  it("the backups five minutes later, and NEVER on a stale check", () => {
    const told = { owner_alerted_at: ago(5), received_at: ago(26) };
    expect(dueAlerts([row(told)], S, NOW.getTime()).backup).toHaveLength(1);
    expect(dueAlerts([row({ ...told, thread_checked_at: ago(60), received_at: ago(600) })], S, NOW.getTime())).toMatchObject({ backup: [], held: 1 });
  });

  it("only the page's two open queues: an external email that is not a broker candidate is never texted", () => {
    expect(dueAlerts([row({ match_state: "none", was_candidate: false })], S, NOW.getTime()).owner).toHaveLength(0);
    expect(dueAlerts([row({ match_state: "several", was_candidate: true })], S, NOW.getTime()).owner).toHaveLength(1);
  });
});

describe("the door check on a held text", () => {
  const msgs = (o: Record<string, unknown>[]) => createSupabaseRecorder({ tables: { broker_mail_messages: postgrestFixture(o) } });
  const item = (id: string, kind = "backup") => ({ key: `broker_mail:${id}:${kind}`, line: id });
  const A = "00000000-0000-4000-8000-0000000000a1";
  const B = "00000000-0000-4000-8000-0000000000b1";
  const held = (o: Record<string, unknown> = {}) => ({ id: "r", user_id: BACKUP, alert: "broker_mail_backup", destination: "+1", title: "t", items: [item(A), item(B)], created_at: ago(30), ...o });

  it("drops a line whose email was answered overnight, and sends the rest", async () => {
    const r = msgs([{ id: A, org_id: ORG, thread_state: "answered_by_owner", thread_checked_at: ago(1) }, { id: B, org_id: ORG, thread_state: "waiting", thread_checked_at: ago(1) }]);
    expect(await brokerMailDoor(r.client, ORG, true, NOW)(held())).toEqual({ send: [item(B)] });
    expectOrgScoped(r, ORG);
  });

  it("everything answered: skipped; the gateway behind: held; texts switched off: skipped; too old: skipped", async () => {
    const answered = msgs([{ id: A, org_id: ORG, thread_state: "answered_by_owner" }, { id: B, org_id: ORG, thread_state: "answered_by_colleague" }]);
    expect(await brokerMailDoor(answered.client, ORG, true, NOW)(held())).toEqual({ skip: "answered" });
    const stale = msgs([{ id: A, org_id: ORG, thread_state: "waiting", thread_checked_at: ago(30) }]);
    expect(await brokerMailDoor(stale.client, ORG, true, NOW)(held({ items: [item(A)] }))).toBe("hold");
    expect(await brokerMailDoor(stale.client, ORG, false, NOW)(held())).toEqual({ skip: "texts_off" });
    expect(await brokerMailDoor(stale.client, ORG, true, NOW)(held({ created_at: ago(17 * 60) }))).toEqual({ skip: "too_old" });
  });
});

describe("one minute's run", () => {
  let rec: SupabaseRecorder;
  const seed = (o: { settings?: Record<string, unknown>[]; enabled?: boolean; messages?: Record<string, unknown>[]; backups?: Record<string, unknown>[] } = {}) => {
    rec = createSupabaseRecorder({
      tables: {
        mail_gateway_config: [{ org_id: ORG, enabled: o.enabled ?? true }],
        broker_mail_settings: o.settings ?? [{ org_id: ORG, ...S }],
        broker_mail_messages: postgrestFixture(o.messages ?? [row()]),
        broker_mail_backups: postgrestFixture(o.backups ?? [{ org_id: ORG, dispatcher_user_id: OWNER, backup_user_id: BACKUP }]),
        loads: postgrestFixture([]),
      },
    });
  };
  beforeEach(() => {
    sent.alerts.mockReset().mockResolvedValue({ bells: 1, emails: 0, texts: 1, textsHeld: 0, fellBack: 0 });
    sent.drain.mockReset().mockResolvedValue({ sent: 0, failed: 0, skipped: 0 });
  });

  it("texts the dispatcher, never falls back to the managers, stamps the row, and drains only broker mail's texts", async () => {
    seed();
    await runBrokerMailTextsOnce(rec.client, {} as never, NOW);
    expect(sent.alerts).toHaveBeenCalledTimes(1);
    const [, , org, alert, events, , opts] = sent.alerts.mock.calls[0]!;
    expect([org, alert, opts]).toEqual([ORG, "broker_mail_waiting", { noFallback: true }]);
    expect(events[0]).toMatchObject({ dedupeKey: "broker_mail:00000000-0000-4000-8000-0000000000d1:owner", relations: { mailbox_owner: OWNER } });
    expect(events[0].line).toBe("chrobinson.com, no load matched, waiting 21 min");
    const stamp = rec.forTable("broker_mail_messages").find((q) => q.write?.method === "update")!;
    expect(Object.keys(stamp.write!.payload as object)).toEqual(["owner_alerted_at"]);
    expect(sent.drain.mock.calls[0]![5].only).toEqual(["broker_mail_waiting", "broker_mail_backup"]);
    expectOrgScoped(rec, ORG, { exempt: ["mail_gateway_config"] });
  });

  it("the backups get the short notice with the dispatcher's name and the time on the carrier's clock", async () => {
    seed({ messages: [row({ owner_alerted_at: ago(6), received_at: ago(26) })] });
    await runBrokerMailTextsOnce(rec.client, {} as never, NOW);
    const [, , , alert, events] = sent.alerts.mock.calls[0]!;
    expect(alert).toBe("broker_mail_backup");
    expect(events[0].relations).toEqual({ dispatcher_backup: [BACKUP] });
    expect(events[0].line).toBe("Waiting since 9:14 PM: chrobinson.com, no load matched, dispatcher Artur");
  });

  it("a dispatcher with no backups: nobody is told, and the row is stamped so it is not asked again", async () => {
    seed({ messages: [row({ owner_alerted_at: ago(6), received_at: ago(26) })], backups: [] });
    await runBrokerMailTextsOnce(rec.client, {} as never, NOW);
    expect(sent.alerts).not.toHaveBeenCalled();
    expect(rec.forTable("broker_mail_messages").some((q) => (q.write?.payload as Record<string, unknown> | undefined)?.backup_alerted_at)).toBe(true);
  });

  it("texts switched off, or the gateway switched off: no alert at all — and the drain's door skips what is held", async () => {
    seed({ settings: [{ org_id: ORG, ...S, texts_on_since: null }] });
    await runBrokerMailTextsOnce(rec.client, {} as never, NOW);
    seed({ enabled: false });
    await runBrokerMailTextsOnce(rec.client, {} as never, NOW);
    expect(sent.alerts).not.toHaveBeenCalled();
    expect(rec.forTable("broker_mail_messages")).toHaveLength(0);
    expect(sent.drain).toHaveBeenCalledTimes(2);
  });

  it("never asks about an email received before the texts were switched on", async () => {
    seed({ settings: [{ org_id: ORG, ...S, texts_on_since: ago(10) }] });
    await runBrokerMailTextsOnce(rec.client, {} as never, NOW);
    expect(sent.alerts).not.toHaveBeenCalled();
  });

  it("no gateway config row: nothing runs", async () => {
    rec = createSupabaseRecorder({ tables: { mail_gateway_config: [] } });
    expect(await runBrokerMailTextsOnce(rec.client, {} as never, NOW)).toBeNull();
    expect(sent.drain).not.toHaveBeenCalled();
  });
});
