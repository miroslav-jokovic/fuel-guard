import { beforeEach, describe, expect, it, vi } from "vitest";
import { drainAlertTexts, readAlertTextQuiet, recordAlertTextReceipt, saveAlertTextQuiet, textOne } from "./alertTexts.js";
import { loadEnv } from "../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../testing/postgrestFixture.js";

/**
 * Alert texts (HOME-TIME-PLAN HT6, D-HT16, D-HT18, D-HT19): a text is a queued row first, waits out the
 * night on the carrier's clock, is checked against the person's number again before it leaves, and its
 * outcome is written once.
 */
const sms = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../../lib/sms.js", async (orig) => ({ ...(await orig<object>()), sendSms: sms.send }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const FRAN = "90000000-0000-4000-8000-0000000000a2";
const PHONE = "+17085550100";
const CHI = "America/Chicago";
const DAY = new Date("2026-11-13T20:00:00.000Z"); // 14:00 Central
const NIGHT = new Date("2026-11-14T04:30:00.000Z"); // 22:30 Central
const MORNING = new Date("2026-11-14T13:00:00.000Z"); // 07:00 Central
const QUIET = { startMin: 1260, endMin: 420 };
const env = loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);

let rec: SupabaseRecorder;
let queuedArgs: Record<string, unknown>[] = [];
const delivery = (o: Record<string, unknown> = {}) => ({
  id: "60000000-0000-4000-8000-000000000001", org_id: ORG, user_id: FRAN, alert: "home_time_overdue", channel: "sms", destination: PHONE, title: "Home time overstayed",
  items: [{ key: "k1", line: "Marcus Hill (truck 702) is past his return" }], status: "queued", not_before: null, created_at: "2026-11-13T19:00:00Z", ...o,
});
const contact = (o: Record<string, unknown> = {}) => ({ org_id: ORG, user_id: FRAN, phone: PHONE, verified_at: "2026-11-01T00:00:00Z", stopped_at: null, ...o });

function seed(w: { deliveries?: Record<string, unknown>[]; contacts?: Record<string, unknown>[]; quiet?: Record<string, unknown>[]; alreadyTexted?: boolean } = {}): void {
  queuedArgs = [];
  rec = createSupabaseRecorder({
    tables: {
      notification_deliveries: postgrestFixture(w.deliveries ?? [delivery()]),
      notification_contacts: postgrestFixture(w.contacts ?? [contact()]),
      notification_channel_settings: postgrestFixture(w.quiet ?? []),
    },
    rpc: (fn: string, args: unknown) => {
      if (fn !== "queue_notification_delivery") return null;
      queuedArgs.push(args as Record<string, unknown>);
      return w.alreadyTexted ? null : "60000000-0000-4000-8000-000000000001";
    },
  });
}
const outcomes = (): RecordedQuery[] => rec.forTable("notification_deliveries").filter((q) => q.write?.method === "update");
const outcome = () => outcomes()[0]!.write!.payload as Record<string, unknown>;
const zone = async () => CHI;
const text = (now: Date) => textOne(rec.client, env, ORG, "home_time_overdue", "Home time overstayed", FRAN, PHONE, [{ key: "k1", line: "Marcus Hill (truck 702) is past his return" }], QUIET, { zone: CHI, now });

beforeEach(() => {
  sms.send.mockReset();
  sms.send.mockResolvedValue({ ok: true, provider: "telnyx", messageId: "tx-9" });
});

describe("one text for a person", () => {
  it("by day: queues it for the ledger, sends it at once, and writes the provider's id on the row", async () => {
    seed();
    expect(await text(DAY)).toBe("sent");
    expect(queuedArgs[0]).toMatchObject({ p_org: ORG, p_user: FRAN, p_channel: "sms", p_destination: PHONE, p_title: "Home time overstayed", p_not_before: null });
    expect(sms.send).toHaveBeenCalledTimes(1);
    expect(sms.send.mock.calls[0]![1]).toEqual({ line: "staff_alerts", to: PHONE, body: "Silvicom 360: Home time overstayed. Marcus Hill (truck 702) is past his return. Reply STOP to end." });
    expect(outcome()).toMatchObject({ status: "sent", sent_at: DAY.toISOString(), provider_message_id: "tx-9" });
    // Written once: only a row still queued takes an outcome.
    expect(outcomes()[0]!.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "status", val: "queued" }]));
    expectOrgScoped(rec, ORG);
  });

  it("at night: queues it for 07:00 on the carrier's clock and sends nothing", async () => {
    seed();
    expect(await text(NIGHT)).toBe("held");
    expect(queuedArgs[0]).toMatchObject({ p_not_before: MORNING.toISOString() });
    expect(sms.send).not.toHaveBeenCalled();
    expect(outcomes()).toEqual([]);
  });

  it("says nothing twice: a fact already texted to this person is neither queued nor sent", async () => {
    seed({ alreadyTexted: true });
    expect(await text(DAY)).toBeNull();
    expect(sms.send).not.toHaveBeenCalled();
  });

  it("records a refused text as failed, with the provider's reason", async () => {
    sms.send.mockResolvedValue({ ok: false, provider: "telnyx", detail: "40329: Tollfree number is not verified" });
    seed();
    expect(await text(DAY)).toBe("failed");
    expect(outcome()).toMatchObject({ status: "failed", attempts: 1, last_error: "40329: Tollfree number is not verified" });
  });
});

describe("the drain", () => {
  it("sends a held text once its morning has come, and leaves one whose time has not", async () => {
    seed({ deliveries: [delivery({ not_before: MORNING.toISOString() }), delivery({ id: "60000000-0000-4000-8000-000000000002", not_before: new Date(MORNING.getTime() + 86_400_000).toISOString() })] });
    expect(await drainAlertTexts(rec.client, env, ORG, new Date(MORNING.getTime() + 60_000), zone)).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(sms.send).toHaveBeenCalledTimes(1);
    expect(outcomes()[0]!.filters()).toContainEqual({ col: "id", val: "60000000-0000-4000-8000-000000000001" });
    const read = rec.forTable("notification_deliveries")[0]!;
    expect(read.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "channel", val: "sms" }, { col: "status", val: "queued" }]));
    expectOrgScoped(rec, ORG);
  });

  it("sends a text a dead run left queued with no hold — but not during the night", async () => {
    seed();
    expect(await drainAlertTexts(rec.client, env, ORG, NIGHT, zone)).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(sms.send).not.toHaveBeenCalled();
    seed();
    expect((await drainAlertTexts(rec.client, env, ORG, DAY, zone)).sent).toBe(1);
  });

  it("asks the clock again at the door: a hold that came due an hour early (a clock change) waits", async () => {
    // Due by its timestamp, still 06:30 on the carrier's wall.
    const early = new Date("2026-11-14T12:30:00.000Z");
    seed({ deliveries: [delivery({ not_before: early.toISOString() })] });
    expect((await drainAlertTexts(rec.client, env, ORG, early, zone)).sent).toBe(0);
    expect(sms.send).not.toHaveBeenCalled();
  });

  it("uses the carrier's own window", async () => {
    // Quiet 13:00–15:00: 14:00 Central is held.
    seed({ quiet: [{ org_id: ORG, sms_quiet_start_min: 780, sms_quiet_end_min: 900 }] });
    expect((await drainAlertTexts(rec.client, env, ORG, DAY, zone)).sent).toBe(0);
  });

  it.each([
    ["stopped overnight", [contact({ stopped_at: "2026-11-14T05:00:00Z" })], "stopped"],
    ["changed their number", [contact({ phone: "+17085559999" })], "number_changed"],
    ["is confirming a new number", [contact({ verified_at: null })], "not_confirmed"],
    ["has no number any more", [], "no_number"],
  ])("does not text somebody who %s: the row is skipped with the reason", async (_n, contacts, reason) => {
    seed({ contacts });
    expect(await drainAlertTexts(rec.client, env, ORG, DAY, zone)).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(sms.send).not.toHaveBeenCalled();
    expect(outcome()).toEqual({ status: "skipped", skip_reason: reason });
  });

  it("costs one read, and no zone lookup, when nothing is queued", async () => {
    seed({ deliveries: [] });
    const zoneOf = vi.fn(zone);
    await drainAlertTexts(rec.client, env, ORG, DAY, zoneOf);
    expect(rec.queries.map((q) => q.table)).toEqual(["notification_deliveries"]);
    expect(zoneOf).not.toHaveBeenCalled();
  });
});

describe("the quiet window's storage", () => {
  it("is 21:00–07:00 for a carrier that saved none, and the carrier's own once saved", async () => {
    seed();
    expect(await readAlertTextQuiet(rec.client, ORG)).toEqual(QUIET);
    seed({ quiet: [{ org_id: ORG, sms_quiet_start_min: 1320, sms_quiet_end_min: 360 }] });
    expect(await readAlertTextQuiet(rec.client, ORG)).toEqual({ startMin: 1320, endMin: 360 });
  });

  it("saves the whole row, signed", async () => {
    seed();
    await saveAlertTextQuiet(rec.client, ORG, FRAN, { startMin: 1320, endMin: 360 }, DAY);
    expect(rec.writtenRows("notification_channel_settings")[0]).toMatchObject({ org_id: ORG, sms_quiet_start_min: 1320, sms_quiet_end_min: 360, updated_by: FRAN });
  });
});

describe("a delivery receipt", () => {
  it("marks our text failed when the mobile carrier refused it, by the provider's id", async () => {
    seed({ deliveries: [delivery({ status: "sent", provider_message_id: "tx-9" })] });
    expect(await recordAlertTextReceipt(rec.client, { messageId: "tx-9", status: "delivery_failed" })).toBe(true);
    expect(outcome()).toEqual({ status: "failed", last_error: "carrier: delivery_failed" });
    expect(outcomes()[0]!.filters()).toContainEqual({ col: "provider_message_id", val: "tx-9" });
  });

  it("changes nothing for a delivered text, and says an id that is not ours is not ours", async () => {
    seed({ deliveries: [delivery({ status: "sent", provider_message_id: "tx-9" })] });
    expect(await recordAlertTextReceipt(rec.client, { messageId: "tx-9", status: "delivered" })).toBe(true);
    expect(await recordAlertTextReceipt(rec.client, { messageId: "someone-elses", status: "delivery_failed" })).toBe(false);
    expect(rec.writes().filter((q) => (q.filters().find((f) => f.col === "provider_message_id")?.val ?? "") === "tx-9")).toEqual([]);
  });
});
