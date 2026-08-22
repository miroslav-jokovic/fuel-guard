import { describe, it, expect, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../testing/supabaseRecorder.js";
import { loadEnv } from "../env.js";
import { handleInboundSms, sendApplicationSms } from "./applicationSms.js";

/**
 * Every reason a text is NOT sent (A11b, D-APP13).
 *
 * The transport asks no questions; this file is where all of them live, and the tests are the list of
 * refusals. A send that should have been held is a TCPA exposure assessed per message — a hold that
 * should have been a send costs a few hours, because the sweep runs every six.
 */

const sms = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../lib/sms.js", async (orig) => ({
  ...(await orig<typeof import("../lib/sms.js")>()),
  sendSms: sms.fn,
}));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
/** Inside the all-US window (16:00 Eastern, 10:00 Hawaii). */
const CIVIL = new Date("2026-08-21T20:00:00Z");
const env = () => loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);

const withConsent = (rows: Record<string, unknown>[] = [{ id: "c-1", phone: "+17082365732", driver_id: DRIVER }]) =>
  createSupabaseRecorder({ tables: { sms_consents: rows }, rpc: { revoke_sms_consent: 1 } });

describe("sending", () => {
  /**
   * ⚠ Draft wording gates the SEND, not just the grant. A consent recorded under placeholder text is
   * not consent to anything — the same reasoning that makes `recordRelease` refuse a signature under
   * `v0-draft`. Until A0 publishes, this is the FIRST refusal every send hits, which is why the rest
   * of this suite has to stub the predicate to reach anything else.
   */
  it("refuses while the consent wording is still draft", async () => {
    sms.fn.mockReset();
    const rec = withConsent();
    const result = await sendApplicationSms(rec.client, env(), ORG, DRIVER, "hello", CIVIL);
    expect(result).toEqual({ sent: false, held: "no_consent" });
    expect(sms.fn).not.toHaveBeenCalled();
  });

  describe("once the wording is published", () => {
    const publish = async () => {
      const shared = await import("@fuelguard/shared");
      return vi.spyOn(shared.SMS_CONSENT, "version", "get").mockReturnValue("v1");
    };

    it("sends when there is a live consent and it is a civil hour", async () => {
      const spy = await publish();
      sms.fn.mockReset().mockResolvedValue({ ok: true, provider: "twilio", messageId: "SM1" });
      const rec = withConsent();
      const result = await sendApplicationSms(rec.client, env(), ORG, DRIVER, "hello", CIVIL);
      spy.mockRestore();

      expect(result).toEqual({ sent: true, messageId: "SM1" });
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

describe("the opt-out", () => {
  it("revokes every live consent on the number that texted STOP", async () => {
    const rec = withConsent([{ org_id: ORG }]);
    const result = await handleInboundSms(rec.client, "(708) 236-5732", "STOP");
    expect(result.revoked).toBe(1);
    const call = rec.rpcs().find((r) => r.fn === "revoke_sms_consent");
    // Normalised on the way in — a stored E.164 and a typed number must match, or the STOP does
    // nothing at all.
    expect((call?.args as Record<string, unknown>).p_phone).toBe("+17082365732");
    // ⚠ The org is resolved FROM the number, never accepted from the request.
    expect((call?.args as Record<string, unknown>).p_org).toBe(ORG);
  });

  it("records what was actually texted, so the file shows why consent ended", async () => {
    const rec = withConsent([{ org_id: ORG }]);
    await handleInboundSms(rec.client, "+17082365732", "please stop");
    const call = rec.rpcs().find((r) => r.fn === "revoke_sms_consent");
    expect(String((call?.args as Record<string, unknown>).p_reason)).toContain("please stop");
  });

  it("does nothing for a message that is not an opt-out", async () => {
    const rec = withConsent([{ org_id: ORG }]);
    expect(await handleInboundSms(rec.client, "+17082365732", "yes still interested")).toEqual({ revoked: 0 });
    expect(rec.rpcs()).toEqual([]);
  });

  it("does nothing for a number it cannot normalise", async () => {
    const rec = withConsent([{ org_id: ORG }]);
    expect(await handleInboundSms(rec.client, "garbage", "STOP")).toEqual({ revoked: 0 });
  });
});
