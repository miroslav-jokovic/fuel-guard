import { describe, it, expect, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../testing/postgrestFixture.js";
import { loadEnv } from "../../env.js";
import { handleInboundSms, sendApplicationSms } from "./applicationSms.js";

/**
 * Every reason a text is NOT sent (A11b, D-APP13).
 *
 * The transport asks no questions; this file is where all of them live, and the tests are the list of
 * refusals. A send that should have been held is a TCPA exposure assessed per message — a hold that
 * should have been a send costs a few hours, because the sweep runs every six.
 */

const sms = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../../lib/sms.js", async (orig) => ({
  ...(await orig<typeof import("../../lib/sms.js")>()),
  sendSms: sms.fn,
}));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const OTHER_ORG = "0f0f0f0f-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NEW_NUMBER = "+17082365732";
const OLD_NUMBER = "+13125550100";
/** Inside the all-US window (16:00 Eastern, 10:00 Hawaii). */
const CIVIL = new Date("2026-08-21T20:00:00Z");
const env = () => loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);

const withConsent = (rows: Record<string, unknown>[] = [{ id: "c-1", phone: "+17082365732", driver_id: DRIVER }]) =>
  createSupabaseRecorder({ tables: { sms_consents: rows }, rpc: { revoke_sms_consent: 1 } });

describe("sending", () => {
  /**
   * ⚠ Draft wording gates the SEND, not just the grant. A consent recorded under placeholder text is
   * not consent to anything — the same reasoning that makes `recordRelease` refuse a signature under
   * `v0-draft`. The wording was published on 2026-09-25 (D-SMS10), so the draft is stubbed here —
   * this is the state a withdrawn or redlined version would return the programme to.
   */
  it("refuses while the consent wording is still draft", async () => {
    const shared = await import("@silvicom/shared");
    const spy = vi.spyOn(shared.SMS_CONSENT, "version", "get").mockReturnValue("v0-draft");
    sms.fn.mockReset();
    const rec = withConsent();
    const result = await sendApplicationSms(rec.client, env(), ORG, DRIVER, "hello", CIVIL);
    spy.mockRestore();
    expect(result).toEqual({ sent: false, held: "no_consent" });
    expect(sms.fn).not.toHaveBeenCalled();
  });

  describe("once the wording is published", () => {
    const publish = async () => {
      const shared = await import("@silvicom/shared");
      return vi.spyOn(shared.SMS_CONSENT, "version", "get").mockReturnValue("v1");
    };

    it("sends when there is a live consent and it is a civil hour", async () => {
      const spy = await publish();
      sms.fn.mockReset().mockResolvedValue({ ok: true, provider: "telnyx", messageId: "msg-1" });
      const rec = withConsent();
      const result = await sendApplicationSms(rec.client, env(), ORG, DRIVER, "hello", CIVIL);
      spy.mockRestore();

      expect(result).toEqual({ sent: true, messageId: "msg-1" });
      expect(sms.fn.mock.calls[0]![1]).toMatchObject({ to: "+17082365732", body: "hello" });
      expectOrgScoped(rec, ORG);
    });

    /** No row at all — the driver never agreed, or the office never asked. */
    it("refuses when there is no consent", async () => {
      const spy = await publish();
      sms.fn.mockReset();
      const rec = withConsent([]);
      const result = await sendApplicationSms(rec.client, env(), ORG, DRIVER, "hello", CIVIL);
      spy.mockRestore();
      expect(result).toEqual({ sent: false, held: "no_consent" });
      expect(sms.fn).not.toHaveBeenCalled();
    });

    /**
     * ⚠ The quiet-hours refusal, at an hour that is civil in one timezone and not in another. 18:00
     * UTC is 14:00 Eastern and 08:00 in Hawaii — one is enough to hold it, because with no known
     * timezone the only honest answer is that it must be civil everywhere.
     */
    it("holds outside the window rather than sending", async () => {
      const spy = await publish();
      sms.fn.mockReset();
      const rec = withConsent();
      const result = await sendApplicationSms(
        rec.client, env(), ORG, DRIVER, "hello", new Date("2026-08-21T18:00:00Z"),
      );
      spy.mockRestore();
      expect(result).toEqual({ sent: false, held: "quiet_hours" });
      expect(sms.fn).not.toHaveBeenCalled();
    });

    /** C2d2: a number that texted STOP is refused whatever the consent rows say. */
    it("refuses a number that texted STOP, and sends again once it is lifted", async () => {
      const spy = await publish();
      sms.fn.mockReset().mockResolvedValue({ ok: true, provider: "telnyx", messageId: "msg-1" });
      const suppressed = (lifted_at: string | null) => createSupabaseRecorder({
        tables: {
          sms_consents: [{ id: "c-1", phone: NEW_NUMBER, driver_id: DRIVER }],
          sms_suppressions: postgrestFixture([{ id: "s-1", org_id: ORG, phone: NEW_NUMBER, reason: "stop", lifted_at }]),
        },
      });
      const held = suppressed(null);
      expect(await sendApplicationSms(held.client, env(), ORG, DRIVER, "hello", CIVIL)).toEqual({ sent: false, held: "suppressed" });
      expect(sms.fn).not.toHaveBeenCalled();
      expectOrgScoped(held, ORG);
      const lifted = suppressed("2026-09-27T10:00:00Z");
      expect(await sendApplicationSms(lifted.client, env(), ORG, DRIVER, "hello", CIVIL)).toEqual({ sent: true, messageId: "msg-1" });
      spy.mockRestore();
    });

    it("refuses a stored number it cannot turn into something dialable", async () => {
      const spy = await publish();
      sms.fn.mockReset();
      const rec = withConsent([{ id: "c-1", phone: "not a number", driver_id: DRIVER }]);
      const result = await sendApplicationSms(rec.client, env(), ORG, DRIVER, "hello", CIVIL);
      spy.mockRestore();
      expect(result).toEqual({ sent: false, held: "no_number" });
      expect(sms.fn).not.toHaveBeenCalled();
    });
  });
});

/**
 * The opt-out and the way back (A11b; G-2 and A-11 in C2d2). `postgrestFixture` rather than flat arrays:
 * the property is which consents a STOP reaches, and a flat fixture hands every row to every read.
 */
const consentRow = (over: Record<string, unknown>) =>
  ({ id: "c", org_id: ORG, driver_id: DRIVER, phone: NEW_NUMBER, revoked_at: null, granted_at: "2026-09-25T10:00:00Z", ...over });

const inbound = (opts: { consents?: Record<string, unknown>[]; suppressions?: Record<string, unknown>[]; insertError?: unknown } = {}) =>
  createSupabaseRecorder({
    tables: {
      sms_consents: postgrestFixture(opts.consents ?? [consentRow({})]),
      sms_suppressions: (q: RecordedQuery) =>
        q.write?.method === "insert"
          ? { data: [], error: null, writeError: opts.insertError }
          : postgrestFixture(opts.suppressions ?? [])(q),
    },
    rpc: { revoke_sms_consent: 1 },
  });
const revokedPhones = (rec: ReturnType<typeof inbound>) =>
  rec.rpcs().filter((r) => r.fn === "revoke_sms_consent").map((r) => (r.args as Record<string, unknown>).p_phone);

describe("the opt-out", () => {
  it("revokes the consent on the number that texted STOP, resolving the org from the number", async () => {
    const rec = inbound();
    const result = await handleInboundSms(rec.client, env(), "(708) 236-5732", "STOP");
    expect(result).toEqual({ revoked: 1, helped: false, resumed: 0 });
    const call = rec.rpcs().find((r) => r.fn === "revoke_sms_consent");
    // Normalised on the way in — a stored E.164 and a typed number must match, or the STOP does
    // nothing at all.
    expect((call?.args as Record<string, unknown>).p_phone).toBe(NEW_NUMBER);
    // ⚠ The org is resolved FROM the number, never accepted from the request.
    expect((call?.args as Record<string, unknown>).p_org).toBe(ORG);
  });

  /**
   * G-2: the applicant agreed on an old number, then on a new one, and texted STOP from the new one.
   * Before C2d2 the old consent became the newest live one and the next text went there.
   */
  it("revokes every live consent the applicant holds, not only the number that texted", async () => {
    const rec = inbound({
      consents: [
        consentRow({ id: "c-new" }),
        consentRow({ id: "c-old", phone: OLD_NUMBER, granted_at: "2026-09-20T10:00:00Z" }),
        // Another applicant's consent on another number in the same org is not theirs to revoke.
        consentRow({ id: "c-else", driver_id: "88888888-8888-4999-8aaa-bbbbbbbbbbbb", phone: "+13125550199" }),
      ],
    });
    const result = await handleInboundSms(rec.client, env(), NEW_NUMBER, "stop");
    expect(result.revoked).toBe(2);
    expect(revokedPhones(rec).sort()).toEqual([OLD_NUMBER, NEW_NUMBER].sort());
  });

  it("suppresses the number in the org, naming the applicant, as a STOP", async () => {
    const rec = inbound();
    await handleInboundSms(rec.client, env(), NEW_NUMBER, "STOP");
    expect(rec.writtenRows("sms_suppressions")).toEqual([{ org_id: ORG, driver_id: DRIVER, phone: NEW_NUMBER, reason: "stop" }]);
  });

  /** A consent already withdrawn on the page: nothing to revoke, and the STOP still stands (G-2). */
  it("suppresses the number even when no consent on it was live", async () => {
    const rec = inbound({ consents: [consentRow({ revoked_at: "2026-09-26T10:00:00Z" })] });
    const result = await handleInboundSms(rec.client, env(), NEW_NUMBER, "STOP");
    expect(result.revoked).toBe(0);
    expect(rec.writtenRows("sms_suppressions")).toHaveLength(1);
  });

  /** 0376 holds one live suppression per (org, phone); a second STOP is already done, not an error. */
  it("treats a second STOP as already suppressed", async () => {
    const rec = inbound({ insertError: { code: "23505", message: "duplicate key" } });
    await expect(handleInboundSms(rec.client, env(), NEW_NUMBER, "STOP")).resolves.toMatchObject({ revoked: 1 });
  });

  it("suppresses nothing for a number no org holds a consent on", async () => {
    const rec = inbound({ consents: [] });
    expect(await handleInboundSms(rec.client, env(), NEW_NUMBER, "STOP")).toEqual({ revoked: 0, helped: false, resumed: 0 });
    expect(rec.writes()).toEqual([]);
  });

  it("records what was actually texted, so the file shows why consent ended", async () => {
    const rec = inbound();
    await handleInboundSms(rec.client, env(), NEW_NUMBER, "please stop");
    const call = rec.rpcs().find((r) => r.fn === "revoke_sms_consent");
    expect(String((call?.args as Record<string, unknown>).p_reason)).toContain("please stop");
  });

  it("does nothing for a message that is not an opt-out", async () => {
    const rec = inbound();
    expect(await handleInboundSms(rec.client, env(), NEW_NUMBER, "yes still interested")).toEqual({
      revoked: 0,
      helped: false,
      resumed: 0,
    });
    // G-2: "quit" inside a sentence about the job is not the keyword.
    expect(await handleInboundSms(rec.client, env(), NEW_NUMBER, "I'll quit my job Friday")).toMatchObject({ revoked: 0 });
    expect(rec.rpcs()).toEqual([]);
    expect(rec.writes()).toEqual([]);
  });

  it("does nothing for a number it cannot normalise", async () => {
    const rec = inbound();
    expect(await handleInboundSms(rec.client, env(), "garbage", "STOP")).toEqual({ revoked: 0, helped: false, resumed: 0 });
  });
});

/**
 * START (C2d2): lifts the suppression a STOP wrote, in each org holding one, and nothing else — the
 * revoked consents stay revoked (0233), and a carrier's block or the office's hold is not the
 * applicant's to lift by text.
 */
describe("the way back", () => {
  const T = new Date("2026-09-27T15:00:00Z");

  it("lifts the STOP suppression through each org that holds one", async () => {
    const rec = inbound({
      suppressions: [
        { id: "s-1", org_id: ORG, phone: NEW_NUMBER, reason: "stop", lifted_at: null },
        { id: "s-2", org_id: OTHER_ORG, phone: NEW_NUMBER, reason: "manual", lifted_at: null },
      ],
    });
    const result = await handleInboundSms(rec.client, env(), NEW_NUMBER, "START", T);
    expect(result).toEqual({ revoked: 0, helped: false, resumed: 1 });
    const lifts = rec.writes().filter((q) => q.table === "sms_suppressions");
    expect(lifts).toHaveLength(1);
    expect(lifts[0]!.write?.payload).toEqual({ lifted_at: T.toISOString() });
    expect(lifts[0]!.filters()).toEqual(expect.arrayContaining([
      { col: "org_id", val: ORG }, { col: "phone", val: NEW_NUMBER }, { col: "reason", val: "stop" },
    ]));
    expect(rec.rpcs()).toEqual([]);
  });

  it("does not read a sentence that mentions starting as a START", async () => {
    const rec = inbound({ suppressions: [{ id: "s-1", org_id: ORG, phone: NEW_NUMBER, reason: "stop", lifted_at: null }] });
    expect(await handleInboundSms(rec.client, env(), NEW_NUMBER, "can I start Monday", T)).toEqual({ revoked: 0, helped: false, resumed: 0 });
    expect(rec.writes()).toEqual([]);
  });
});

/**
 * HELP, which US carriers require every A2P sender to answer and which this product had written,
 * tested in `smsConsentContract.test.ts`, and never wired to anything — `isHelpMessage` had no
 * caller until 2026-09-06. An unanswered HELP is a carrier violation on its own and is one of the
 * things a toll-free verification submission is asked about directly, so it fails the submission
 * before it ever costs a complaint.
 */
describe("the HELP keyword", () => {
  it("answers HELP even though the sender has no consent, no civil hour and draft wording", async () => {
    // Every gate `sendApplicationSms` enforces is shut here: no consent row at all, and the wording
    // stubbed back to a draft (it was published 2026-09-25, D-SMS10).
    const shared = await import("@silvicom/shared");
    const spy = vi.spyOn(shared.SMS_CONSENT, "version", "get").mockReturnValue("v0-draft");
    const rec = createSupabaseRecorder({ tables: { sms_consents: [] } });
    sms.fn.mockReset().mockResolvedValue({ ok: true, provider: "telnyx", messageId: "m-1" });

    const result = await handleInboundSms(
      rec.client, loadEnv({ NODE_ENV: "test", WEB_APP_URL: "https://360.silvicominc.com" } as unknown as NodeJS.ProcessEnv),
      "+17082365732", "HELP",
    );
    spy.mockRestore();

    expect(result).toEqual({ revoked: 0, helped: true, resumed: 0 });
    expect(sms.fn).toHaveBeenCalledOnce();
    const sent = sms.fn.mock.calls[0]![1] as { to: string; body: string };
    expect(sent.to).toBe("+17082365732");
    // The three things a carrier requires the answer to carry: who we are, that rates may apply,
    // and how to stop. Asserted as content rather than as an exact string, so the wording can be
    // improved without the test becoming a copy of it.
    expect(sent.body).toContain("Silvicom");
    expect(sent.body.toLowerCase()).toContain("rates may apply");
    expect(sent.body).toContain("STOP");
    // CTIA's fourth: somewhere to get help — the terms page, on the deployment's own host.
    expect(sent.body).toContain("360.silvicominc.com/sms-terms");
    // One message part, one charge.
    expect(sent.body.length).toBeLessThanOrEqual(160);
  });

  it("does not revoke anything — HELP is a question, not an opt-out", async () => {
    const rec = inbound();
    sms.fn.mockReset().mockResolvedValue({ ok: true, provider: "telnyx" });

    await handleInboundSms(rec.client, env(), "+17082365732", "help");

    expect(rec.rpcs()).toEqual([]);
    expect(rec.writes()).toEqual([]);
  });

  it("reports a failed HELP reply rather than claiming it answered", async () => {
    const rec = createSupabaseRecorder({ tables: { sms_consents: [] } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    sms.fn.mockReset().mockResolvedValue({ ok: false, provider: "none", detail: "No SMS provider configured" });

    const result = await handleInboundSms(rec.client, env(), "+17082365732", "HELP");

    expect(result.helped).toBe(false);
    spy.mockRestore();
  });

  // The line between the two keywords, which `isStopMessage`'s word-boundary match makes worth
  // pinning: "help me stop these texts" contains STOP and must revoke, not answer HELP.
  it("treats a message that asks to stop as an opt-out even when it says help", async () => {
    const rec = inbound();
    sms.fn.mockReset();

    const result = await handleInboundSms(rec.client, env(), "+17082365732", "help me stop these texts");

    expect(result.revoked).toBe(1);
    expect(sms.fn).not.toHaveBeenCalled();
  });
});
