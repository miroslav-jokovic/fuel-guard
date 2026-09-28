import { afterEach, describe, it, expect, vi } from "vitest";
import { SMS_CONSENT } from "@silvicom/shared";
import {
  createSupabaseRecorder,
  expectOrgScoped,
  type RecordedQuery,
  type SupabaseRecorder,
} from "../../testing/supabaseRecorder.js";
import { loadEnv } from "../../env.js";
import { nudgeEmail, runApplicationNudgesOnce } from "./applicationNudgeSweep.js";

/**
 * The abandonment sweep (A10).
 *
 * ⚠ The property this file exists for is an ORDER: the token is rotated before the email is sent.
 * There is no link to re-send — 0220 stores a SHA-256 and nothing else — so the nudge mints a new
 * token and rotates the invitation's hash to match. Send-then-rotate would email a link that does not
 * work yet; rotate-then-send costs, at worst, an email the driver never got, with the office alert
 * still telling somebody to phone them.
 */

const sent = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../../lib/mailer.js", () => ({ sendEmail: sent.fn }));
const sms = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../../lib/sms.js", async (orig) => ({ ...(await orig<object>()), sendSms: sms.fn }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const NOW = new Date("2026-08-21T12:00:00Z");
const STALE = "2026-08-18T12:00:00Z";
const env = () => loadEnv({ NODE_ENV: "test", WEB_APP_URL: "https://app.test" } as NodeJS.ProcessEnv);

const seed = (over: {
  invitation?: Record<string, unknown>;
  draft?: Record<string, unknown> | null;
  rotated?: unknown;
  /** Part 1's writes outside the draft (C3c3b). Absent: none. */
  intake?: string;
  capture?: string;
  permission?: string;
  /** A live consent to be texted (Q-AW29). Absent: none, so the text is held and the email still goes. */
  consent?: boolean;
} = {}): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      application_invitations: [{
        id: "inv-1", driver_id: DRIVER, email: "susan@example.test",
        expires_at: "2026-09-01T00:00:00Z", revoked_at: null, submitted_at: null, nudged_at: null,
        review_requested_at: null, approved_at: null,
        // Sent: the office gave them the form, and they stopped filling it in (AF4).
        application_sent_at: "2026-08-10T09:00:00Z",
        consented_at: "2026-08-01T09:00:00Z", releases_completed_at: "2026-08-01T10:00:00Z",
        ...over.invitation,
      }],
      application_intakes: over.intake ? [{ invitation_id: "inv-1", updated_at: over.intake }] : [],
      application_captures: over.capture ? [{ invitation_id: "inv-1", captured_at: over.capture }] : [],
      driver_authorizations: over.permission ? [{ invitation_id: "inv-1", created_at: over.permission }] : [],
      application_drafts: over.draft === null ? [] : [{
        invitation_id: "inv-1", updated_at: STALE, furthest_section: "employment", ...over.draft,
      }],
      organizations: [{ name: "Silvicom Inc", notifications_enabled: true }],
      sms_consents: over.consent
        ? [{ org_id: ORG, driver_id: DRIVER, phone: "+17082365732", revoked_at: null, granted_at: "2026-08-01T00:00:00Z" }]
        : [],
      sms_outbox: (q: RecordedQuery) => (q.write?.method === "insert" ? [{ id: "o-1" }] : []),
      drivers: [{ full_name: "Susan Godfrey" }],
    },
    rpc: {
      nudge_application_invitation: over.rotated === undefined ? true : over.rotated,
      rotate_invitation_sms_token: true,
      emit_notification: "notif-1",
    },
  });

describe("the sweep", () => {
  it("rotates the token and only then sends the link that rotation produced", async () => {
    sent.fn.mockReset().mockResolvedValue({ ok: true });
    const rec = seed();
    const result = await runApplicationNudgesOnce(rec.client, env(), ORG, ["user-1"], NOW);

    // `messaged: 0` — A11b wired SMS in, and it stays zero until a consent row and a configured
    // provider both exist. The email is unconditional for exactly that reason.
    expect(result).toEqual({ stalled: 1, emailed: 1, messaged: 0 });
    const rotate = rec.rpcs().find((r) => r.fn === "nudge_application_invitation");
    expect(rotate).toBeTruthy();
    // A fresh 64-character hash — not the one already on the row.
    expect(String((rotate?.args as Record<string, unknown>).p_token_hash)).toMatch(/^[0-9a-f]{64}$/);

    // And the emailed link carries the PLAINTEXT the rotation was derived from, which is the only
    // moment it exists anywhere.
    const [email] = sent.fn.mock.calls[0]!.slice(1) as [{ text: string; to: string[] }];
    expect(email.to).toEqual(["susan@example.test"]);
    expect(email.text).toContain("https://app.test/apply/");
    expectOrgScoped(rec, ORG, {
      // Filtered by primary key, which IS the tenant id — the `dqAlertScheduler.test.ts` exemption.
      exempt: ["organizations"],
    });
  });

  /**
   * The race the RPC's own WHERE clause exists for: the driver submitted between the sweep reading
   * them and the rotation. `false` means nothing was rotated, so there is nothing to email.
   */
  it("sends nothing when the invitation moved on under it", async () => {
    sent.fn.mockReset().mockResolvedValue({ ok: true });
    const rec = seed({ rotated: false });
    const result = await runApplicationNudgesOnce(rec.client, env(), ORG, ["user-1"], NOW);
    expect(result).toEqual({ stalled: 1, emailed: 0, messaged: 0 });
    expect(sent.fn).not.toHaveBeenCalled();
  });

  /**
   * ⚠ No address: the office is told, and the invitation is NOT touched. Rotating would kill the
   * driver's only link, and stamping would spend the one nudge on an email nobody could receive.
   */
  it("alerts the office without touching the link when there is nowhere to send", async () => {
    sent.fn.mockReset().mockResolvedValue({ ok: true });
    const rec = seed({ invitation: { email: null } });
    const result = await runApplicationNudgesOnce(rec.client, env(), ORG, ["user-1"], NOW);

    expect(result).toEqual({ stalled: 1, emailed: 0, messaged: 0 });
    expect(sent.fn).not.toHaveBeenCalled();
    expect(rec.rpcs().some((r) => r.fn === "nudge_application_invitation")).toBe(false);
    // The office still hears about it — that is the cue to pick up the phone.
    expect(rec.rpcs().some((r) => r.fn === "emit_notification")).toBe(true);
  });

  it("does nothing at all for a draft that is still warm", async () => {
    sent.fn.mockReset().mockResolvedValue({ ok: true });
    const rec = seed({ draft: { updated_at: "2026-08-21T11:00:00Z" } });
    expect(await runApplicationNudgesOnce(rec.client, env(), ORG, ["user-1"], NOW))
      .toEqual({ stalled: 0, emailed: 0, messaged: 0 });
    expect(rec.rpcs()).toEqual([]);
  });

  /** The driver email is switchable on its own; the office half is not what a carrier turns off. */
  it("keeps the office alert when the driver email is disabled", async () => {
    sent.fn.mockReset().mockResolvedValue({ ok: true });
    const rec = seed();
    const off = loadEnv({
      NODE_ENV: "test", WEB_APP_URL: "https://app.test", APPLICATION_NUDGE_ENABLED: "false",
    } as NodeJS.ProcessEnv);
    const result = await runApplicationNudgesOnce(rec.client, off, ORG, ["user-1"], NOW);

    expect(result).toEqual({ stalled: 1, emailed: 0, messaged: 0 });
    expect(sent.fn).not.toHaveBeenCalled();
    expect(rec.rpcs().some((r) => r.fn === "emit_notification")).toBe(true);
  });
});

/**
 * ⚠ A1 — the applicant who is waiting on the office (2026-09-18).
 *
 * The rule lives in `planApplicationNudges`; these two tests are about the half of A1 that a pure
 * fold cannot reach, and they fail for different reasons on purpose.
 *
 * The first is end-to-end: it proves the sweep actually consults the fold before it alerts and
 * before it rotates. ⚠ `alertOffice()` runs BEFORE the `APPLICATION_NUDGE_ENABLED` check, which is
 * why switching the flag off in production on 2026-09-18 stopped the rotation and left the false
 * "stopped part-way through" alert in place. The fold is the only place that fixes both.
 *
 * The second reads the recorded `select`, which looks like testing the fake rather than the code.
 * It is not: `supabaseRecorder` hands back whole fixture rows whatever a query asked for, so the
 * first test would pass word for word even if `candidates()` never selected the two stamps — in
 * production the columns would arrive `undefined`, the fold would wave the invitation through, and
 * every assertion here would still be green. The column list IS the contract with PostgREST, so it
 * is what gets asserted.
 */
describe("an applicant the office is sitting on", () => {
  const approved = { review_requested_at: "2026-08-19T09:00:00Z", approved_at: "2026-08-20T09:00:00Z" };

  it("neither alerts the office nor rotates the link of an approved applicant", async () => {
    sent.fn.mockReset().mockResolvedValue({ ok: true });
    const rec = seed({ invitation: approved });
    expect(await runApplicationNudgesOnce(rec.client, env(), ORG, ["user-1"], NOW))
      .toEqual({ stalled: 0, emailed: 0, messaged: 0 });
    // Not "no rotation" — NOTHING. A rotation would take the link out from under a person whose
    // next act is to sign, and the alert would tell the office that the office is late.
    expect(rec.rpcs()).toEqual([]);
    expect(sent.fn).not.toHaveBeenCalled();
  });

  it("asks PostgREST for both phase stamps", async () => {
    sent.fn.mockReset().mockResolvedValue({ ok: true });
    const rec = seed({ invitation: approved });
    await runApplicationNudgesOnce(rec.client, env(), ORG, ["user-1"], NOW);
    const columns = String(
      rec.forTable("application_invitations")[0]?.ops.find((o) => o.method === "select")?.args[0] ?? "",
    );
    expect(columns).toContain("review_requested_at");
    expect(columns).toContain("approved_at");
    // ⚠ AF4. Unselected, it reads `undefined`, the fold treats that as "not sent", and the sweep
    // stops nudging anybody at all — silently, because nothing errors.
    expect(columns).toContain("application_sent_at");
  });

  /**
   * AF4: somebody whose permissions are in and whose form has not been SENT is waiting on the
   * office's screening. Their identity draft goes stale in two days; they have abandoned nothing.
   */
  it("neither alerts the office nor rotates the link of an applicant waiting for the form", async () => {
    sent.fn.mockReset().mockResolvedValue({ ok: true });
    const rec = seed({ invitation: { application_sent_at: null } });
    expect(await runApplicationNudgesOnce(rec.client, env(), ORG, ["user-1"], NOW))
      .toEqual({ stalled: 0, emailed: 0, messaged: 0 });
    expect(rec.rpcs()).toEqual([]);
  });
});

describe("what the driver reads", () => {
  it("says what is saved, where they stopped, and that the older link is dead", () => {
    const { subject, text } = nudgeEmail("Silvicom Inc", "https://app.test/apply/abc", "Where you have worked");
    expect(subject).toContain("Silvicom Inc");
    expect(text).toContain("Where you have worked");
    // The one caveat rotation makes necessary, said plainly rather than left to be discovered.
    expect(text).toContain("replaces the one in the earlier email");
    // And no second reminder is promised, because there will not be one.
    expect(text).toContain("we will not send another reminder.");
    expect(text).not.toContain("about this step");
  });

  it("omits the section when the driver never reached a named one", () => {
    expect(nudgeEmail("Silvicom Inc", "https://app.test/apply/abc", null).text)
      .not.toContain("You had reached");
  });
});

/**
 * C3c3b — the driver who stopped in Part 1 (Q-AW37 (b): one reminder per part, 0377).
 *
 * They consented and did not finish the permissions. What these add to the fold's own tests is the
 * half a pure function cannot reach: that the sweep READS the three places Part 1 writes outside the
 * draft (a null there reads as "nothing written", which would remind somebody mid-way through), that
 * it asks PostgREST for Part 1's stamps, and that the driver and the office are told it was Part 1.
 */
describe("the driver who stopped in Part 1", () => {
  const partOne = { application_sent_at: null, releases_completed_at: null, consented_at: STALE };
  const warm = "2026-08-21T11:00:00Z";

  it("is reminded once, with Part 1's words, and the office is told it was Part 1", async () => {
    sent.fn.mockReset().mockResolvedValue({ ok: true });
    const rec = seed({ invitation: partOne, draft: { furthest_section: "employment" }, intake: STALE, capture: STALE });
    expect(await runApplicationNudgesOnce(rec.client, env(), ORG, ["user-1"], NOW))
      .toEqual({ stalled: 1, emailed: 1, messaged: 0 });
    expect(rec.rpcs().some((r) => r.fn === "nudge_application_invitation")).toBe(true);
    const alert = rec.rpcs().find((r) => r.fn === "emit_notification")!.args as Record<string, unknown>;
    expect(JSON.stringify(alert)).toContain("application_stalled_part_one:inv-1");
    expect(JSON.stringify(alert)).toContain("Susan Godfrey stopped before finishing getting started on their application");
    const [email] = sent.fn.mock.calls[0]!.slice(1) as [{ text: string }];
    // Part 2 may still remind them about the form, so Part 1 promises only what is true.
    expect(email.text).toContain("we will not remind you about this step again.");
    expect(email.text).not.toContain("will not send another reminder");
    // Sections are Part 2's; a Part 1 reminder never names one.
    expect(email.text).not.toContain("You had reached");
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] });
  });

  /** Each read on its own: every one of them is the only sign of life for somebody. */
  it.each([
    ["the intake row", { intake: warm }],
    ["a photograph", { capture: warm }],
    ["a signed permission", { permission: warm }],
  ])("is left alone while %s was written inside the window", async (_label, activity) => {
    sent.fn.mockReset().mockResolvedValue({ ok: true });
    const rec = seed({ invitation: partOne, ...activity });
    expect(await runApplicationNudgesOnce(rec.client, env(), ORG, ["user-1"], NOW))
      .toEqual({ stalled: 0, emailed: 0, messaged: 0 });
    expect(rec.rpcs()).toEqual([]);
  });

  /** The LATEST write counts: an old intake row beside yesterday's photograph is somebody still at it. */
  it("reads the latest of Part 1's writes, not the earliest", async () => {
    sent.fn.mockReset().mockResolvedValue({ ok: true });
    const rec = seed({ invitation: partOne, intake: STALE, capture: warm, permission: STALE });
    expect(await runApplicationNudgesOnce(rec.client, env(), ORG, ["user-1"], NOW))
      .toEqual({ stalled: 0, emailed: 0, messaged: 0 });
  });

  it("asks PostgREST for Part 1's stamps and each activity column", async () => {
    sent.fn.mockReset().mockResolvedValue({ ok: true });
    const rec = seed({ invitation: partOne });
    await runApplicationNudgesOnce(rec.client, env(), ORG, ["user-1"], NOW);
    const select = (table: string) =>
      String(rec.forTable(table)[0]?.ops.find((o) => o.method === "select")?.args[0] ?? "");
    expect(select("application_invitations")).toContain("consented_at");
    expect(select("application_invitations")).toContain("releases_completed_at");
    expect(select("application_intakes")).toBe("invitation_id, updated_at");
    expect(select("application_captures")).toBe("invitation_id, captured_at");
    expect(select("driver_authorizations")).toBe("invitation_id, created_at");
  });

  /**
   * ⚠ 0377: a driver reminded in Part 1 is still owed Part 2's reminder, so the read must not drop a
   * stamped invitation. The recorder ignores filters, so the filter itself is what is asserted.
   */
  it("still reads an invitation already reminded in Part 1, and reminds it about the form", async () => {
    sent.fn.mockReset().mockResolvedValue({ ok: true });
    const rec = seed({ invitation: { nudged_at: "2026-08-05T09:00:00Z" } });
    expect(await runApplicationNudgesOnce(rec.client, env(), ORG, ["user-1"], NOW))
      .toEqual({ stalled: 1, emailed: 1, messaged: 0 });
    const ops = rec.forTable("application_invitations")[0]?.ops ?? [];
    expect(ops.some((o) => o.method === "is" && o.args[0] === "revoked_at")).toBe(true);
    expect(ops.some((o) => o.method === "is" && o.args[0] === "nudged_at")).toBe(false);
  });

  /**
   * ⚠ The defect C3c3b found: AF3 writes the draft on the first visit, so a form sent today arrives
   * with a draft days old, and the old clock reminded at once — rotating away the link just sent.
   */
  it("leaves a form the office sent an hour ago alone, however old the draft", async () => {
    sent.fn.mockReset().mockResolvedValue({ ok: true });
    const rec = seed({ invitation: { application_sent_at: warm } });
    expect(await runApplicationNudgesOnce(rec.client, env(), ORG, ["user-1"], NOW))
      .toEqual({ stalled: 0, emailed: 0, messaged: 0 });
    expect(rec.rpcs()).toEqual([]);
  });
});

/**
 * Q-AW29 (0378): the reminder's TEXT goes through the outbox. At night it waits for the driver's
 * morning instead of being dropped, and its link is its own — minted when it goes, on the text token —
 * so the email's link (the rotation above) is never the one in the text.
 */
describe("the reminder's text", () => {
  afterEach(() => { vi.restoreAllMocks(); sms.fn.mockReset(); });
  const publish = () => vi.spyOn(SMS_CONSENT, "version", "get").mockReturnValue("v1");

  it("waits in the outbox at night, as a nudge, with no link in it", async () => {
    publish();
    sent.fn.mockReset().mockResolvedValue({ ok: true });
    const rec = seed({ consent: true });
    // 03:00 Chicago.
    const night = new Date("2026-08-21T08:00:00Z");
    expect(await runApplicationNudgesOnce(rec.client, env(), ORG, ["user-1"], night))
      .toEqual({ stalled: 1, emailed: 1, messaged: 0 });
    expect(rec.writtenRows("sms_outbox")[0]).toMatchObject({
      status: "queued", template: "nudge", reason: "nudge", invitation_id: "inv-1", params: {},
    });
    expect(sms.fn).not.toHaveBeenCalled();
    expect(rec.rpcs().some((r) => r.fn === "rotate_invitation_sms_token")).toBe(false);
  });

  it("goes at once in the day, on a link that is not the email's", async () => {
    publish();
    sent.fn.mockReset().mockResolvedValue({ ok: true });
    sms.fn.mockResolvedValue({ ok: true, provider: "telnyx", messageId: "m-1" });
    const rec = seed({ consent: true });
    // 16:00 Eastern, 10:00 Hawaii — open everywhere, since no state is on file. (`NOW` is 02:00 in Hawaii.)
    const day = new Date("2026-08-21T20:00:00Z");
    expect(await runApplicationNudgesOnce(rec.client, env(), ORG, ["user-1"], day))
      .toEqual({ stalled: 1, emailed: 1, messaged: 1 });
    const texted = String(sms.fn.mock.calls[0]![1].body).match(/\/apply\/([A-Za-z0-9_-]+)/)?.[1] ?? "";
    const [email] = sent.fn.mock.calls[0]!.slice(1) as [{ text: string }];
    expect(texted).not.toBe("");
    expect(email.text).not.toContain(texted);
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] });
  });
});
