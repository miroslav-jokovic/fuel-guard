import { beforeEach, describe, expect, it, vi } from "vitest";
import { SMS_OFFICE_INVITE_ATTESTATION } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../testing/postgrestFixture.js";
import { loadEnv } from "../../env.js";

/**
 * An invitation by text (Q-AW55, D-SMS11). What is pinned: the attestation is written as a consent row
 * under its own source and wording with the recruiter's attribution; the audit names the recruiter and
 * never the number; the text goes through the outbox with the invitation's lifetime; a number that
 * texted STOP, or that is not a US mobile, is refused with NOTHING written; a provider that is off
 * still gets the row; and a number already live writes no second row.
 */
const sms = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../../lib/sms.js", async (orig) => ({ ...(await orig<object>()), sendSms: sms.fn }));

const { inviteByText } = await import("./applicationInviteText.js");

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INV = "44444444-5555-4666-8777-888888888888";
const CONSENT = "99999999-aaaa-4bbb-8ccc-dddddddddddd";
const USER = "user-recruiter";
const configured = loadEnv({ NODE_ENV: "test", SMS_PROVIDER: "telnyx", TELNYX_API_KEY: "k", TELNYX_FROM: "+18005550100" } as NodeJS.ProcessEnv);
const off = loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
// A fresh invitation has no Part 1 state, so the outbox uses the strict all-US window (UTC-10 to UTC-4):
// 21:00 UTC is 11:00 in Hawaii and 17:00 on the East Coast, open everywhere; 09:00 UTC is shut everywhere.
const OPEN = new Date("2027-01-12T21:00:00Z");
const SHUT = new Date("2027-01-12T09:00:00Z");

/**
 * The consent table REMEMBERS the row this call inserts: the outbox reads the live consent back from the
 * database before sending (`sendOrQueueSms`, every send path's rule), so a fixture that forgot the insert
 * would answer `no_consent` to the very attestation just written.
 */
const seed = (over: { consents?: unknown[]; suppressions?: unknown[]; consentInsert?: unknown[] } = {}) => {
  const consents = [...(over.consents ?? [])] as Record<string, unknown>[];
  return createSupabaseRecorder({
    rpc: { rotate_invitation_sms_token: true },
    tables: {
      sms_consents: (q: RecordedQuery) => {
        if (q.write?.method === "insert") {
          const landed = over.consentInsert ?? [{ id: CONSENT }];
          if (landed.length) consents.push({ ...(q.write.payload as Record<string, unknown>), id: CONSENT, revoked_at: null, granted_at: "2027-01-12T00:00:00Z" });
          return landed;
        }
        return postgrestFixture(consents)(q);
      },
      sms_suppressions: postgrestFixture((over.suppressions ?? []) as Record<string, unknown>[]),
      sms_outbox: (q: RecordedQuery) => (q.write ? [{ id: "o-1" }] : []),
      application_intakes: [],
      organizations: [{ name: "Silvicom Inc" }],
      audit_logs: [],
    },
  });
};

const input = (rawPhone = "(708) 236-5732") => ({
  orgId: ORG, userId: USER, driverId: DRIVER, invitationId: INV, days: 14, rawPhone,
  ctx: { ip: "10.0.0.9", userAgent: "office-browser" },
});

beforeEach(() => sms.fn.mockReset().mockResolvedValue({ ok: true, provider: "telnyx", messageId: "tx-1" }));

describe("inviting by text", () => {
  it("records the attestation on the number, under its own source and wording, with the recruiter's attribution", async () => {
    const rec = seed();
    const out = await inviteByText(rec.client, configured, input(), OPEN);
    expect(out).toEqual({ outcome: "sent", phoneLast4: "5732", notBefore: null, reason: null });

    const [row] = rec.writtenRows("sms_consents");
    expect(row).toMatchObject({
      org_id: ORG, driver_id: DRIVER, phone: "+17082365732", source: "office_invite",
      consent_version: SMS_OFFICE_INVITE_ATTESTATION.version,
      granted_ip: "10.0.0.9", granted_user_agent: "office-browser",
    });
    // The office's words with the carrier named — never the applicant's instrument put in the recruiter's mouth.
    expect(row!.consent_text).toContain("Recorded by the office of Silvicom Inc");
    expect(row!.consent_text).toContain("STOP");
    expect(row!.intent_statement).toBe("This person asked Silvicom Inc to text them the link to their driver application.");
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] });
  });

  it("audits the recruiter, the ids and the last four digits — never the number or the link", async () => {
    const rec = seed();
    await inviteByText(rec.client, configured, input(), OPEN);
    const [audit] = rec.writtenRows("audit_logs");
    expect(audit).toMatchObject({ action: "compliance.applicant_invited_by_text", actor_id: USER, entity_id: CONSENT });
    expect(audit!.meta).toEqual({
      driverId: DRIVER, invitationId: INV, attestationVersion: SMS_OFFICE_INVITE_ATTESTATION.version,
      phoneLast4: "5732", reusedConsent: false,
    });
    const text = JSON.stringify(audit);
    expect(text).not.toContain("7082365732");
    expect(text).not.toContain("/apply/");
  });

  it("sends the invitation through the outbox, on the text token, saying how long the link works", async () => {
    const rec = seed();
    await inviteByText(rec.client, configured, { ...input(), days: 21 }, OPEN);
    expect(rec.writtenRows("sms_outbox")[0]).toMatchObject({ template: "invite", reason: "invite", params: { days: 21 }, phone: "+17082365732" });
    expect(rec.rpcs().some((r) => r.fn === "rotate_invitation_sms_token")).toBe(true);
    const body = String(sms.fn.mock.calls[0]![1].body);
    expect(body).toContain("Silvicom Inc: You asked us to text you");
    expect(body).toContain("works for 21 days");
    expect(body).toMatch(/\/apply\/[A-Za-z0-9_-]{43}/);
  });

  it("queues it outside the window and says when it goes", async () => {
    const rec = seed();
    const out = await inviteByText(rec.client, configured, input(), SHUT);
    expect(out).toMatchObject({ outcome: "queued", phoneLast4: "5732", notBefore: expect.stringMatching(/T/) });
    expect(sms.fn).not.toHaveBeenCalled();
    expect(rec.writtenRows("sms_consents")).toHaveLength(1);
  });

  /** The office cannot overrule what the person said by text (C2d2): nothing is written. */
  it("refuses a number that texted STOP, and writes nothing", async () => {
    const rec = seed({ suppressions: [{ org_id: ORG, phone: "+17082365732", lifted_at: null }] });
    const out = await inviteByText(rec.client, configured, input(), OPEN);
    expect(out).toEqual({ outcome: "refused", phoneLast4: "5732", notBefore: null, reason: "number_stopped" });
    expect(rec.writes()).toEqual([]);
    expect(sms.fn).not.toHaveBeenCalled();
  });

  it("refuses a number that is not a US mobile, and writes nothing", async () => {
    for (const bad of ["123", "(123) 456-7890", "+44 20 7946 0000"]) {
      const rec = seed();
      expect(await inviteByText(rec.client, configured, input(bad), OPEN)).toMatchObject({ outcome: "refused", reason: "invalid_phone", phoneLast4: null });
      expect(rec.writes()).toEqual([]);
    }
  });

  /** The attestation is a fact about what the applicant asked, not about whether Telnyx is configured. */
  it("still records the attestation when texts are switched off for this account, and says so", async () => {
    const rec = seed();
    const out = await inviteByText(rec.client, off, input(), OPEN);
    expect(out).toEqual({ outcome: "failed", phoneLast4: "5732", notBefore: null, reason: "sms_disabled" });
    expect(rec.writtenRows("sms_consents")).toHaveLength(1);
    expect(rec.writtenRows("audit_logs")).toHaveLength(1);
    expect(rec.writtenRows("sms_outbox")).toEqual([]);
  });

  it("writes no second row for a number already live, and says the consent was reused", async () => {
    const rec = seed({ consents: [{ id: CONSENT, org_id: ORG, driver_id: DRIVER, phone: "+17082365732", revoked_at: null, granted_at: "2026-10-01T00:00:00Z" }] });
    const out = await inviteByText(rec.client, configured, input(), OPEN);
    expect(out.outcome).toBe("sent");
    expect(rec.writtenRows("sms_consents")).toEqual([]);
    expect(rec.writtenRows("audit_logs")[0]!.meta).toMatchObject({ reusedConsent: true });
  });

  it("reports a row that did not land, and sends nothing on it", async () => {
    const rec = seed({ consentInsert: [] });
    const out = await inviteByText(rec.client, configured, input(), OPEN);
    expect(out).toMatchObject({ outcome: "refused", reason: "consent_failed" });
    expect(rec.writtenRows("audit_logs")).toEqual([]);
    expect(sms.fn).not.toHaveBeenCalled();
  });
});
