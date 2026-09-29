import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../testing/postgrestFixture.js";
import { loadEnv } from "../../env.js";
import { hashInvitationToken } from "./applicationIntake.js";

/**
 * The SMS outbox (A-11, D-AW12, C2d): a text outside its recipient's civil hours is queued and sent
 * by the drain, never held and dropped; what it announced is re-checked before it goes; a carrier's
 * receipt lands on the row.
 */
const sms = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../../lib/sms.js", async (orig) => ({ ...(await orig<object>()), sendSms: sms.fn }));

const { drainSmsOutboxForOrg, recordDeliveryReceipt, sendOrQueueSms } = await import("./smsOutbox.js");

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER = "0f0f0f0f-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const APPT = "33333333-4444-4555-8666-777777777777";
const env = loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);

// January, no DST: 16:00 UTC = 10:00 Chicago (open everywhere in IL); 09:00 UTC = 03:00 Chicago (shut).
const OPEN = new Date("2027-01-12T16:00:00Z");
const SHUT = new Date("2027-01-12T09:00:00Z");

beforeEach(() => sms.fn.mockReset().mockResolvedValue({ ok: true, provider: "telnyx", messageId: "tx-1" }));
afterEach(() => vi.restoreAllMocks());

const consent = (over: Record<string, unknown> = {}) =>
  ({ org_id: ORG, driver_id: DRIVER, phone: "+17082365732", revoked_at: null, granted_at: "2026-09-25T10:00:00Z", ...over });

const seed = (over: {
  consents?: unknown[]; state?: string | null; outbox?: unknown[]; appointments?: unknown[]; suppressions?: unknown[];
  /** Q-AW29: the invitation a link-bearing text is about, and what the text-token rotation answers. */
  invitations?: unknown[]; rotated?: unknown;
} = {}) =>
  createSupabaseRecorder({
    rpc: { rotate_invitation_sms_token: over.rotated === undefined ? true : over.rotated },
    tables: {
      sms_consents: postgrestFixture((over.consents ?? [consent()]) as Record<string, unknown>[]),
      application_intakes: postgrestFixture(
        over.state === undefined ? [{ org_id: ORG, invitation_id: "inv-1", state: "IL" }]
          : [{ org_id: ORG, invitation_id: "inv-1", state: over.state }],
      ),
      sms_outbox: (q: RecordedQuery) => {
        if (q.write?.method === "insert") return [{ id: "o-new" }];
        if (q.write?.method === "update") return [{ id: "claimed" }];
        return postgrestFixture((over.outbox ?? []) as Record<string, unknown>[])(q);
      },
      drug_test_appointments: postgrestFixture((over.appointments ?? []) as Record<string, unknown>[]),
      sms_suppressions: postgrestFixture((over.suppressions ?? []) as Record<string, unknown>[]),
      organizations: [{ name: "Silvicom Inc", operating_hours: { tz: "America/Chicago" } }],
      application_invitations: postgrestFixture((over.invitations ?? [
        { id: "inv-1", org_id: ORG, submitted_at: null, review_requested_at: null, approved_at: null },
      ]) as Record<string, unknown>[]),
    },
  });

const message = (over: Record<string, unknown> = {}) => ({
  orgId: ORG, driverId: DRIVER, invitationId: "inv-1", template: "consent_confirm" as const, params: {}, ...over,
});

describe("sendOrQueueSms", () => {
  it("sends inside the recipient's window and records the send on its row", async () => {
    const rec = seed();
    const out = await sendOrQueueSms(rec.client, env, message(), OPEN);
    expect(out).toEqual({ sent: true, outboxId: "o-new" });
    const [inserted, sent] = rec.writtenRows("sms_outbox");
    expect(inserted).toMatchObject({ status: "sending", phone: "+17082365732", template: "consent_confirm", reason: "consent_confirm", params: {} });
    expect(sent).toMatchObject({ status: "sent", provider_message_id: "tx-1", attempts: 1 });
    expect(sms.fn.mock.calls[0]![1]).toMatchObject({ to: "+17082365732" });
    // Organizations is read by its own id; everything else carries org_id.
    expectOrgScoped(rec, ORG);
  });

  it("queues outside the window for the next opening in the state Part 1 gave, and sends nothing", async () => {
    const rec = seed();
    const out = await sendOrQueueSms(rec.client, env, message(), SHUT);
    expect(out).toMatchObject({ sent: false, queued: true, notBefore: "2027-01-12T15:00:00.000Z" });
    expect(rec.writtenRows("sms_outbox")[0]).toMatchObject({ status: "queued", not_before: "2027-01-12T15:00:00.000Z" });
    expect(sms.fn).not.toHaveBeenCalled();
  });

  it("uses the all-US window when Part 1 named no state", async () => {
    // 15:00 UTC is 09:00 Chicago but 05:00 Honolulu: open for IL, shut for an unknown state.
    const at = new Date("2027-01-12T15:00:00Z");
    expect(await sendOrQueueSms(seed().client, env, message(), at)).toMatchObject({ sent: true });
    expect(await sendOrQueueSms(seed({ state: null }).client, env, message(), at)).toMatchObject({ queued: true });
  });

  it("holds without a live consent, and writes nothing", async () => {
    const rec = seed({ consents: [consent({ revoked_at: "2026-09-26T00:00:00Z" })] });
    expect(await sendOrQueueSms(rec.client, env, message(), OPEN)).toEqual({ sent: false, held: "no_consent" });
    expect(rec.writtenRows("sms_outbox")).toEqual([]);
  });

  /** C2d2: a number that texted STOP is not "not now" — nothing is queued for it. */
  it("holds a number that texted STOP, and queues nothing for it", async () => {
    const rec = seed({ suppressions: [
      { id: "s-1", org_id: ORG, phone: "+17082365732", reason: "stop", lifted_at: null },
      // Another org's suppression is that org's; a lifted one is no suppression at all.
      { id: "s-2", org_id: OTHER, phone: "+13125550100", reason: "stop", lifted_at: null },
    ] });
    expect(await sendOrQueueSms(rec.client, env, message(), SHUT)).toEqual({ sent: false, held: "suppressed" });
    expect(rec.writtenRows("sms_outbox")).toEqual([]);
    expect(sms.fn).not.toHaveBeenCalled();
    expectOrgScoped(rec, ORG);

    const lifted = seed({ suppressions: [{ id: "s-1", org_id: ORG, phone: "+17082365732", reason: "stop", lifted_at: "2027-01-12T08:00:00Z" }] });
    expect(await sendOrQueueSms(lifted.client, env, message(), OPEN)).toEqual({ sent: true, outboxId: "o-new" });
  });

  it("stamps the appointment when a drug-test text leaves, through the appointment's owner", async () => {
    const rec = seed({ appointments: [{ id: APPT, org_id: ORG, cancelled_at: null, sent_to_driver_at: null }] });
    await sendOrQueueSms(rec.client, env, message({
      template: "drug_test_site",
      params: { appointment_id: APPT, site_name: "Concentra", site_address: "1 Main St", site_phone: null,
        window_start: "2027-01-13T15:00:00Z", window_end: null, donor_reference: null },
    }), OPEN);
    expect(rec.writtenRows("drug_test_appointments")[0]).toEqual({ sent_to_driver_at: OPEN.toISOString() });
    // "Text it again" must not move the date of the first send.
    const stamp = rec.forTable("drug_test_appointments").find((q) => q.write)!;
    expect(stamp.filters()).toContainEqual({ col: "sent_to_driver_at", val: null });
    expect(String(sms.fn.mock.calls[0]![1].body)).toContain("Concentra, 1 Main St, 01/13/2027 9:00 AM CST");
  });
});

describe("drainSmsOutboxForOrg", () => {
  const queued = (over: Record<string, unknown> = {}) => ({
    id: "o-1", org_id: ORG, driver_id: DRIVER, invitation_id: "inv-1", phone: "+17082365732", template: "consent_confirm",
    params: {}, attempts: 0, status: "queued", not_before: "2027-01-12T15:00:00Z", expires_at: "2027-01-14T00:00:00Z", ...over,
  });
  const updates = (rec: ReturnType<typeof seed>) => rec.writtenRows("sms_outbox");

  it("claims a due row, sends it, and reads only this org's due, queued rows", async () => {
    const rec = seed({ outbox: [
      queued(), queued({ id: "o-other", org_id: OTHER }), queued({ id: "o-later", not_before: "2027-01-13T15:00:00Z" }),
      queued({ id: "o-done", status: "sent" }),
    ] });
    expect(await drainSmsOutboxForOrg(rec.client, env, ORG, OPEN)).toEqual({ sent: 1, failed: 0, cancelled: 0, deferred: 0 });
    expect(updates(rec)).toEqual([
      { status: "sending" },
      expect.objectContaining({ status: "sent", provider_message_id: "tx-1" }),
    ]);
    const claim = rec.forTable("sms_outbox").find((q) => q.write)!;
    expect(claim.filters()).toContainEqual({ col: "status", val: "queued" });
    expectOrgScoped(rec, ORG);
  });

  it("cancels a row whose lifetime ran out, sending nothing", async () => {
    const rec = seed({ outbox: [queued({ expires_at: "2027-01-12T12:00:00Z" })] });
    expect(await drainSmsOutboxForOrg(rec.client, env, ORG, OPEN)).toMatchObject({ cancelled: 1, sent: 0 });
    expect(updates(rec)[0]).toMatchObject({ status: "cancelled" });
    expect(sms.fn).not.toHaveBeenCalled();
  });

  it("cancels a row whose consent was withdrawn, or moved to another number, while it waited", async () => {
    for (const consents of [[consent({ revoked_at: "2027-01-12T10:00:00Z" })], [consent({ phone: "+13125550100" })]]) {
      const rec = seed({ consents, outbox: [queued()] });
      expect(await drainSmsOutboxForOrg(rec.client, env, ORG, OPEN)).toMatchObject({ cancelled: 1 });
    }
    expect(sms.fn).not.toHaveBeenCalled();
  });

  /** C2d2: the STOP arrived while the text waited for its window. */
  it("cancels a row whose number texted STOP while it waited", async () => {
    const rec = seed({ outbox: [queued()], suppressions: [{ id: "s-1", org_id: ORG, phone: "+17082365732", reason: "stop", lifted_at: null }] });
    expect(await drainSmsOutboxForOrg(rec.client, env, ORG, OPEN)).toMatchObject({ cancelled: 1, sent: 0 });
    expect(updates(rec)).toEqual([{ status: "cancelled", last_error: "number texted STOP while queued" }]);
    expect(sms.fn).not.toHaveBeenCalled();
  });

  it("cancels a drug-test text whose appointment was cancelled while it waited", async () => {
    const rec = seed({
      outbox: [queued({ template: "drug_test_site", params: { appointment_id: APPT } })],
      appointments: [{ id: APPT, org_id: ORG, cancelled_at: "2027-01-12T10:00:00Z" }],
    });
    expect(await drainSmsOutboxForOrg(rec.client, env, ORG, OPEN)).toMatchObject({ cancelled: 1 });
    expect(sms.fn).not.toHaveBeenCalled();
  });

  it("defers a row whose window has shut again to the next opening", async () => {
    const rec = seed({ outbox: [queued({ not_before: "2027-01-12T08:00:00Z" })] });
    expect(await drainSmsOutboxForOrg(rec.client, env, ORG, SHUT)).toMatchObject({ deferred: 1 });
    expect(updates(rec)[0]).toEqual({ not_before: "2027-01-12T15:00:00.000Z" });
    expect(sms.fn).not.toHaveBeenCalled();
  });

  it("sends nothing when another drainer won the claim", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        sms_consents: postgrestFixture([consent()]),
        application_intakes: postgrestFixture([{ org_id: ORG, invitation_id: "inv-1", state: "IL" }]),
        sms_outbox: (q: RecordedQuery) => (q.write ? [] : postgrestFixture([queued()])(q)),
      },
    });
    expect(await drainSmsOutboxForOrg(rec.client, env, ORG, OPEN)).toEqual({ sent: 0, failed: 0, cancelled: 0, deferred: 0 });
    expect(sms.fn).not.toHaveBeenCalled();
  });

  it("records a provider refusal as failed", async () => {
    sms.fn.mockResolvedValue({ ok: false, provider: "telnyx", detail: "Invalid destination" });
    const rec = seed({ outbox: [queued()] });
    expect(await drainSmsOutboxForOrg(rec.client, env, ORG, OPEN)).toMatchObject({ failed: 1 });
    expect(updates(rec)[1]).toMatchObject({ status: "failed", last_error: "Invalid destination", attempts: 1 });
  });
});

/**
 * Q-AW29 (a), 0378: the texts that carry the applicant's link. The link is never in the row — 0376
 * refuses a URL in the params — and is minted when the text GOES, on the invitation's text-only token,
 * so a text that waited overnight never rotates the link the email and the office's screen hold.
 */
describe("a text that carries the link", () => {
  const rotation = (rec: ReturnType<typeof seed>) =>
    rec.rpcs().find((r) => r.fn === "rotate_invitation_sms_token")?.args as Record<string, unknown> | undefined;
  /** The token in the text, and the hash the rotation was handed: they must be one pair. */
  const tokenIn = (body: string): string => body.match(/\/apply\/([A-Za-z0-9_-]+)/)?.[1] ?? "";

  it.each([
    ["application_sent", "Your driver application is ready"],
    ["nudge", "Your driver application is saved"],
    ["signing_link", "Sign your driver application here"],
  ] as const)("sends %s with a link minted now, on the text token, the pair matching", async (template, words) => {
    const rec = seed();
    let rotatedBeforeSend = false;
    sms.fn.mockImplementation(async () => {
      rotatedBeforeSend = rotation(rec) !== undefined;
      return { ok: true, provider: "telnyx", messageId: "tx-1" };
    });
    const out = await sendOrQueueSms(rec.client, env, message({ template }), OPEN);
    expect(out).toEqual({ sent: true, outboxId: "o-new" });
    const body = String(sms.fn.mock.calls[0]![1].body);
    expect(body).toContain(words);
    const args = rotation(rec)!;
    expect(args).toMatchObject({ p_org: ORG, p_invitation: "inv-1" });
    expect(hashInvitationToken(tokenIn(body))).toBe(args.p_token_hash);
    // Rotate FIRST, then send: a failure between them costs a text, never a link that does not work yet.
    expect(rotatedBeforeSend).toBe(true);
    // The row holds no link, and the reason is 0376's word for it.
    expect(rec.writtenRows("sms_outbox")[0]).toMatchObject({ template, reason: template, params: {} });
    expect(JSON.stringify(rec.writtenRows("sms_outbox"))).not.toContain("/apply/");
    expectOrgScoped(rec, ORG);
  });

  it("queues one outside the window WITHOUT minting a link — that waits for the send", async () => {
    const rec = seed();
    expect(await sendOrQueueSms(rec.client, env, message({ template: "application_sent" }), SHUT)).toMatchObject({ queued: true });
    expect(rotation(rec)).toBeUndefined();
    expect(sms.fn).not.toHaveBeenCalled();
  });

  /** The rotation refuses a revoked or lapsed invitation, and a text that is only a link is then nothing. */
  it("cancels, and sends nothing, when the invitation is no longer live", async () => {
    const rec = seed({ rotated: false });
    const out = await sendOrQueueSms(rec.client, env, message({ template: "nudge" }), OPEN);
    expect(out).toMatchObject({ sent: false, failed: expect.any(String) });
    expect(sms.fn).not.toHaveBeenCalled();
    expect(rec.writtenRows("sms_outbox").at(-1)).toMatchObject({ status: "cancelled" });
  });

  const queued = (template: string) => ({
    id: "o-1", org_id: ORG, driver_id: DRIVER, invitation_id: "inv-1", phone: "+17082365732", template,
    params: {}, attempts: 0, status: "queued", not_before: "2027-01-12T15:00:00Z", expires_at: "2027-01-13T15:00:00Z",
  });

  it("drains a queued one in the morning, minting its link then", async () => {
    const rec = seed({ outbox: [queued("application_sent")] });
    expect(await drainSmsOutboxForOrg(rec.client, env, ORG, OPEN)).toEqual({ sent: 1, failed: 0, cancelled: 0, deferred: 0 });
    const body = String(sms.fn.mock.calls[0]![1].body);
    expect(hashInvitationToken(tokenIn(body))).toBe(rotation(rec)!.p_token_hash);
    expectOrgScoped(rec, ORG);
  });

  it.each([
    ["handed to the office", { review_requested_at: "2027-01-12T10:00:00Z" }],
    ["approved", { approved_at: "2027-01-12T10:00:00Z" }],
    ["filed", { submitted_at: "2027-01-12T10:00:00Z" }],
  ])("cancels a queued one whose application was %s overnight, minting nothing", async (_label, moved) => {
    const rec = seed({
      outbox: [queued("nudge")],
      invitations: [{ id: "inv-1", org_id: ORG, submitted_at: null, review_requested_at: null, approved_at: null, ...moved }],
    });
    expect(await drainSmsOutboxForOrg(rec.client, env, ORG, OPEN)).toMatchObject({ sent: 0, cancelled: 1 });
    expect(rotation(rec)).toBeUndefined();
    expect(sms.fn).not.toHaveBeenCalled();
  });

  it("counts one the rotation refused as cancelled, not failed", async () => {
    const rec = seed({ outbox: [queued("application_sent")], rotated: false });
    expect(await drainSmsOutboxForOrg(rec.client, env, ORG, OPEN)).toEqual({ sent: 0, failed: 0, cancelled: 1, deferred: 0 });
    expect(sms.fn).not.toHaveBeenCalled();
  });

  /**
   * D-AW14 (C3s3a): a queued sign link is worth sending only while its send is. ⚠ The stop matters most:
   * the drain mints a FRESH text token, so a text sent after five wrong dates of birth would reopen the
   * door the stop closed.
   */
  const signing = (over: Record<string, unknown> = {}) => ({
    id: "inv-1", org_id: ORG, submitted_at: null, review_requested_at: "2027-01-10T10:00:00Z",
    approved_at: "2027-01-11T10:00:00Z", sign_link_expires_at: "2027-01-14T10:00:00Z", unlock_failures: 0, ...over,
  });

  it("drains a queued sign link while its send is live — approved is its whole point, not a reason to cancel", async () => {
    const rec = seed({ outbox: [queued("signing_link")], invitations: [signing()] });
    expect(await drainSmsOutboxForOrg(rec.client, env, ORG, OPEN)).toMatchObject({ sent: 1, cancelled: 0 });
    expect(String(sms.fn.mock.calls[0]![1].body)).toContain("This link works for 72 hours.");
    expectOrgScoped(rec, ORG);
  });

  it.each([
    ["stopped by five wrong dates of birth", { unlock_failures: 5 }],
    ["past its 72 hours", { sign_link_expires_at: "2027-01-12T15:59:59Z" }],
    ["filed", { submitted_at: "2027-01-12T10:00:00Z" }],
    ["never sent for signing", { sign_link_expires_at: null }],
  ])("cancels a queued sign link whose send was %s, minting nothing", async (_label, moved) => {
    const rec = seed({ outbox: [queued("signing_link")], invitations: [signing(moved)] });
    expect(await drainSmsOutboxForOrg(rec.client, env, ORG, OPEN)).toMatchObject({ sent: 0, cancelled: 1 });
    expect(rotation(rec)).toBeUndefined();
    expect(sms.fn).not.toHaveBeenCalled();
  });

  it("cancels a queued link text that names no invitation — there is no link to mint", async () => {
    const rec = seed({ outbox: [{ ...queued("nudge"), invitation_id: null }] });
    expect(await drainSmsOutboxForOrg(rec.client, env, ORG, OPEN)).toMatchObject({ sent: 0, cancelled: 1 });
    expect(sms.fn).not.toHaveBeenCalled();
  });
});

describe("recordDeliveryReceipt", () => {
  const rec = () => createSupabaseRecorder({
    tables: { sms_outbox: postgrestFixture([{ id: "o-1", org_id: ORG, provider_message_id: "tx-1" }]) },
  });

  it("marks a delivered text delivered and a refused one failed, writing through the row's own org", async () => {
    const r1 = rec();
    expect(await recordDeliveryReceipt(r1.client, { messageId: "tx-1", status: "delivered" }, OPEN)).toBe(true);
    expect(r1.writtenRows("sms_outbox")[0]).toEqual({ status: "delivered", delivered_at: OPEN.toISOString() });
    // The receipt names no org, so its READ finds the row by the provider's id — the one unscoped
    // query here; the write goes back through the row's own org.
    expectOrgScoped(r1, ORG, { exempt: ["sms_outbox"] });
    expect(r1.forTable("sms_outbox").find((q) => q.write)!.filters()).toContainEqual({ col: "org_id", val: ORG });
    const r2 = rec();
    await recordDeliveryReceipt(r2.client, { messageId: "tx-1", status: "delivery_failed" }, OPEN);
    expect(r2.writtenRows("sms_outbox")[0]).toMatchObject({ status: "failed", last_error: "carrier: delivery_failed" });
  });

  it("ignores an id that is not ours and a status that is not final", async () => {
    const r = rec();
    expect(await recordDeliveryReceipt(r.client, { messageId: "tx-9", status: "delivered" }, OPEN)).toBe(false);
    expect(await recordDeliveryReceipt(r.client, { messageId: "tx-1", status: "delivery_unconfirmed" }, OPEN)).toBe(false);
    expect(r.writtenRows("sms_outbox")).toEqual([]);
  });
});
