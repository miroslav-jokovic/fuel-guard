import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALERT_TEXT_CONSENT, alertTextHelpReply } from "@silvicom/shared";
import { confirmAlertPhone, handleAlertInboundSms, isAlertContactRefusal, readMyAlertContact, startAlertPhone, stopAlertTexts } from "./alertContacts.js";
import { loadEnv } from "../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../testing/postgrestFixture.js";

/**
 * A person's mobile number for alert texts (HOME-TIME-PLAN D-HT17, HT6): nobody is texted an alert at a
 * number they have not proved is theirs, a code is checked without being stored, and STOP means stop.
 */
const sms = vi.hoisted(() => ({ send: vi.fn(), configured: true }));
vi.mock("../../lib/sms.js", async (orig) => ({ ...(await orig<object>()), sendSms: sms.send, smsConfigured: (_env: unknown, line?: string) => line === "staff_alerts" && sms.configured }));
// ↑ `configured` is the ALERT line's answer. The applicant line reads false here on purpose: code that
// asked it instead would find every test below "not set up".

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DANA = "90000000-0000-4000-8000-0000000000a0";
const PHONE = "+17085550100";
const NOW = new Date("2026-11-13T15:00:00.000Z");
const mins = (n: number) => new Date(NOW.getTime() + n * 60_000);
const env = loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);

let rec: SupabaseRecorder;
const contact = (o: Record<string, unknown> = {}) => ({ org_id: ORG, user_id: DANA, phone: PHONE, code_hash: null, code_expires_at: null, attempts: 0, verified_at: null, stopped_at: null, ...o });
function seed(rows: Record<string, unknown>[] = []): void {
  rec = createSupabaseRecorder({ tables: { notification_contacts: postgrestFixture(rows), audit_logs: [] } });
}
const writes = (method: string): RecordedQuery[] => rec.forTable("notification_contacts").filter((q) => q.write?.method === method);
const payload = (q: RecordedQuery) => q.write!.payload as Record<string, unknown>;
/** The code as the person would read it off their phone. */
const textedCode = (): string => /code: (\d{6})/.exec((sms.send.mock.calls.at(-1)![1] as { body: string }).body)![1]!;
/** Start, and hand back the row as the database would now hold it. */
async function started(rows: Record<string, unknown>[] = [], phone = "(708) 555-0100", at = NOW): Promise<Record<string, unknown>> {
  seed(rows);
  const out = await startAlertPhone(rec.client, env, ORG, DANA, phone, at);
  expect(isAlertContactRefusal(out), JSON.stringify(out)).toBe(false);
  return payload(writes("upsert")[0]!);
}

beforeEach(() => {
  sms.send.mockReset();
  sms.send.mockResolvedValue({ ok: true, provider: "telnyx", messageId: "m-1" });
  sms.configured = true;
});

describe("asking for a code", () => {
  it("writes the whole row un-confirmed with only the code's hash, then texts the code to the number", async () => {
    const row = await started();
    expect(row).toMatchObject({ org_id: ORG, user_id: DANA, phone: PHONE, attempts: 0, verified_at: null, stopped_at: null, consent_text: null });
    expect(row.code_expires_at).toBe(mins(10).toISOString());
    const code = textedCode();
    expect(String(row.code_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(code);
    expect(sms.send.mock.calls[0]![1]).toMatchObject({ to: PHONE, body: `Silvicom 360 code: ${code}. It expires in 10 minutes. If you did not ask for it, ignore this text.` });
    expectOrgScoped(rec, ORG);
  });

  it("un-confirms a number that was confirmed: until the new code is typed, nobody is texted at an unproved number", async () => {
    const row = await started([contact({ verified_at: "2026-11-01T00:00:00Z", phone: "+17085559999" })]);
    expect(row).toMatchObject({ phone: PHONE, verified_at: null });
  });

  it("keeps a STOP on the same number, and starts a different number clean", async () => {
    expect((await started([contact({ stopped_at: "2026-11-02T00:00:00Z" })])).stopped_at).toBe("2026-11-02T00:00:00Z");
    expect((await started([contact({ stopped_at: "2026-11-02T00:00:00Z", phone: "+17085559999" })])).stopped_at).toBeNull();
  });

  it.each([
    ["a server that cannot text", () => (sms.configured = false), "708 555 0100", "unavailable"],
    ["something that is not a number", () => undefined, "555-01", "invalid"],
  ])("refuses %s and writes nothing", async (_n, arrange, phone, code) => {
    seed();
    arrange();
    expect(await startAlertPhone(rec.client, env, ORG, DANA, phone, NOW)).toMatchObject({ code });
    expect(rec.writes()).toEqual([]);
    expect(sms.send).not.toHaveBeenCalled();
  });

  it("refuses a second code within a minute of the last, and gives one after it", async () => {
    const pending = contact({ code_hash: "aa", code_expires_at: mins(10).toISOString() });
    seed([pending]);
    expect(await startAlertPhone(rec.client, env, ORG, DANA, PHONE, new Date(NOW.getTime() + 59_000))).toMatchObject({ code: "too_soon" });
    expect(sms.send).not.toHaveBeenCalled();
    seed([pending]);
    expect(isAlertContactRefusal(await startAlertPhone(rec.client, env, ORG, DANA, PHONE, new Date(NOW.getTime() + 61_000)))).toBe(false);
  });

  it("texts the code on the staff-alert line, never the applicant one", async () => {
    await started();
    expect((sms.send.mock.calls[0]![1] as { line?: string }).line).toBe("staff_alerts");
  });

  it("says so when the text could not be sent, and names START for a number that once said STOP", async () => {
    sms.send.mockResolvedValue({ ok: false, provider: "telnyx", detail: "40300 blocked" });
    seed();
    const out = await startAlertPhone(rec.client, env, ORG, DANA, PHONE, NOW);
    expect(out).toMatchObject({ code: "send_failed" });
    expect((out as { message: string }).message).toContain("START");
  });
});

describe("typing the code back", () => {
  async function pending(o: Record<string, unknown> = {}): Promise<string> {
    const row = await started();
    const code = textedCode();
    seed([{ ...row, ...o }]);
    return code;
  }
  const other = (code: string) => (code === "000000" ? "000001" : "000000");

  it("confirms on the right code: the consent's words are stored, the hash is gone, a STOP is lifted", async () => {
    const code = await pending({ stopped_at: "2026-11-02T00:00:00Z" });
    expect(await confirmAlertPhone(rec.client, env, ORG, DANA, code, mins(5))).toEqual({ available: true, state: "verified", last4: "0100" });
    const up = writes("update")[0]!;
    expect(payload(up)).toMatchObject({ verified_at: mins(5).toISOString(), stopped_at: null, code_hash: null, code_expires_at: null, attempts: 0, consent_text: ALERT_TEXT_CONSENT.text, consent_version: ALERT_TEXT_CONSENT.version });
    expect(up.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "user_id", val: DANA }]));
    // Against THIS code: a newer one asked for in between is not confirmed by the old digits.
    expect(up.filters().some((f) => f.col === "code_hash")).toBe(true);
    expectOrgScoped(rec, ORG);
  });

  it("counts a wrong code and says how many tries are left, confirming nothing", async () => {
    const code = await pending({ attempts: 3 });
    const out = await confirmAlertPhone(rec.client, env, ORG, DANA, other(code), mins(1));
    expect(out).toMatchObject({ code: "wrong", message: "That is not the code. 1 try left." });
    expect(payload(writes("update")[0]!)).toMatchObject({ attempts: 4 });
    expect(payload(writes("update")[0]!)).not.toHaveProperty("verified_at");
  });

  it("refuses even the RIGHT code after five wrong tries, after ten minutes, and when none was asked for", async () => {
    let code = await pending({ attempts: 5 });
    expect(await confirmAlertPhone(rec.client, env, ORG, DANA, code, mins(1))).toMatchObject({ code: "locked" });
    code = await pending();
    expect(await confirmAlertPhone(rec.client, env, ORG, DANA, code, mins(10))).toMatchObject({ code: "expired" });
    seed([contact({ verified_at: "2026-11-01T00:00:00Z" })]);
    expect(await confirmAlertPhone(rec.client, env, ORG, DANA, "123456", NOW)).toMatchObject({ code: "invalid" });
    expect(rec.writes()).toEqual([]);
  });

  it("does not accept a code issued to somebody else", async () => {
    const row = await started();
    const code = textedCode();
    const EVE = "90000000-0000-4000-8000-0000000000ee";
    seed([{ ...row, user_id: EVE }]);
    expect(await confirmAlertPhone(rec.client, env, ORG, EVE, code, mins(1))).toMatchObject({ code: "wrong" });
  });
});

describe("where a person's texts stand, and stopping them", () => {
  it("shows the last four digits only", async () => {
    seed([contact({ verified_at: "2026-11-01T00:00:00Z" })]);
    expect(await readMyAlertContact(rec.client, env, ORG, DANA)).toEqual({ available: true, state: "verified", last4: "0100" });
    seed();
    expect(await readMyAlertContact(rec.client, env, ORG, DANA)).toEqual({ available: true, state: "none", last4: null });
  });

  it("the page's stop sets the same column a reply of STOP does, on the caller's own row", async () => {
    seed([contact({ verified_at: "2026-11-01T00:00:00Z" })]);
    await stopAlertTexts(rec.client, env, ORG, DANA, NOW);
    const up = writes("update")[0]!;
    expect(payload(up)).toMatchObject({ stopped_at: NOW.toISOString() });
    expect(up.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "user_id", val: DANA }]));
    expectOrgScoped(rec, ORG);
  });
});

describe("a reply to our number", () => {
  const audits = () => rec.writtenRows("audit_logs") as Record<string, unknown>[];

  it("STOP stops every row holding that number, whatever its carrier, and each is audited as the person's own act", async () => {
    seed([contact({ verified_at: "t" })]);
    expect(await handleAlertInboundSms(rec.client, env, "+1 708 555 0100", " Stop ", NOW)).toEqual({ stopped: 1, resumed: 0, helped: false });
    const up = writes("update")[0]!;
    expect(payload(up)).toMatchObject({ stopped_at: NOW.toISOString() });
    expect(up.filters()).toContainEqual({ col: "phone", val: PHONE });
    expect(up.filters().some((f) => f.col === "org_id")).toBe(false);
    expect(audits()[0]).toMatchObject({ org_id: ORG, actor_id: DANA, action: "alerts.text_stopped", meta: { by: "reply" } });
  });

  it("reads STOP by the product's one rule: the word anywhere in the message counts (`isStopMessage`, G-2)", async () => {
    seed([contact({ verified_at: "t" })]);
    expect((await handleAlertInboundSms(rec.client, env, PHONE, "please stop texting me", NOW)).stopped).toBe(1);
  });

  it("START lifts a stop, and an ordinary message changes nothing", async () => {
    seed([contact({ verified_at: "t", stopped_at: "t" })]);
    expect(await handleAlertInboundSms(rec.client, env, PHONE, "START", NOW)).toEqual({ stopped: 0, resumed: 1, helped: false });
    expect(payload(writes("update")[0]!)).toMatchObject({ stopped_at: null });
    // START is not a way to confirm a number: only a row that was confirmed and then stopped is lifted.
    // Read from the query itself — the stand-in database does not apply a negated filter.
    const nots = writes("update")[0]!.ops.filter((o) => o.method === "not").map((o) => o.args);
    expect(nots).toEqual(expect.arrayContaining([["stopped_at", "is", null], ["verified_at", "is", null]]));
    seed([contact({ verified_at: "t" })]);
    expect(await handleAlertInboundSms(rec.client, env, PHONE, "ok, see you Monday", NOW)).toEqual({ stopped: 0, resumed: 0, helped: false });
    expect(await handleAlertInboundSms(rec.client, env, "not a number", "STOP", NOW)).toEqual({ stopped: 0, resumed: 0, helped: false });
    expect(rec.writes()).toEqual([]);
    expect(sms.send).not.toHaveBeenCalled();
  });

  it("HELP is answered from the alert number with the staff words, to anybody, and changes no row", async () => {
    seed();
    expect(await handleAlertInboundSms(rec.client, env, PHONE, " help ", NOW)).toEqual({ stopped: 0, resumed: 0, helped: true });
    expect(sms.send.mock.calls[0]![1]).toEqual({ to: PHONE, body: alertTextHelpReply("localhost:5173"), line: "staff_alerts" });
    expect(rec.writes()).toEqual([]);
  });
});
