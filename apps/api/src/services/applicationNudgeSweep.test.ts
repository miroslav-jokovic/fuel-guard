import { describe, it, expect, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../testing/supabaseRecorder.js";
import { loadEnv } from "../env.js";
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
vi.mock("../lib/mailer.js", () => ({ sendEmail: sent.fn }));

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

    expect(result).toEqual({ stalled: 1, emailed: 1 });
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
    expect(result).toEqual({ stalled: 1, emailed: 0 });
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

    expect(result).toEqual({ stalled: 1, emailed: 0 });
    expect(sent.fn).not.toHaveBeenCalled();
    expect(rec.rpcs().some((r) => r.fn === "nudge_application_invitation")).toBe(false);
    // The office still hears about it — that is the cue to pick up the phone.
    expect(rec.rpcs().some((r) => r.fn === "emit_notification")).toBe(true);
  });

  it("does nothing at all for a draft that is still warm", async () => {
    sent.fn.mockReset().mockResolvedValue({ ok: true });
    const rec = seed({ draft: { updated_at: "2026-08-21T11:00:00Z" } });
    expect(await runApplicationNudgesOnce(rec.client, env(), ORG, ["user-1"], NOW))
      .toEqual({ stalled: 0, emailed: 0 });
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

    expect(result).toEqual({ stalled: 1, emailed: 0 });
    expect(sent.fn).not.toHaveBeenCalled();
    expect(rec.rpcs().some((r) => r.fn === "emit_notification")).toBe(true);
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
