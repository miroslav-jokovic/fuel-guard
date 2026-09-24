import { describe, it, expect, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../testing/supabaseRecorder.js";
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

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const NOW = new Date("2026-08-21T12:00:00Z");
const STALE = "2026-08-18T12:00:00Z";
const env = () => loadEnv({ NODE_ENV: "test", WEB_APP_URL: "https://app.test" } as NodeJS.ProcessEnv);

const seed = (over: {
  invitation?: Record<string, unknown>;
  draft?: Record<string, unknown> | null;
  rotated?: unknown;
} = {}): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      application_invitations: [{
        id: "inv-1", driver_id: DRIVER, email: "susan@example.test",
        expires_at: "2026-09-01T00:00:00Z", revoked_at: null, submitted_at: null, nudged_at: null,
        review_requested_at: null, approved_at: null,
        // Sent: the office gave them the form, and they stopped filling it in (AF4).
        application_sent_at: "2026-08-10T09:00:00Z",
        ...over.invitation,
      }],
      application_drafts: over.draft === null ? [] : [{
        invitation_id: "inv-1", updated_at: STALE, furthest_section: "employment", ...over.draft,
      }],
      organizations: [{ name: "Silvicom Inc", notifications_enabled: true }],
      drivers: [{ full_name: "Susan Godfrey" }],
    },
    rpc: {
      nudge_application_invitation: over.rotated === undefined ? true : over.rotated,
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
    expect(text).toContain("will not send another reminder");
  });

  it("omits the section when the driver never reached a named one", () => {
    expect(nudgeEmail("Silvicom Inc", "https://app.test/apply/abc", null).text)
      .not.toContain("You had reached");
  });
});
