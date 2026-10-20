import { describe, expect, it, vi } from "vitest";
import { rolesThatManage } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { loadEnv } from "../../env.js";
import { announceReadyToScreen, readyToScreenEmail, readyToScreenLink } from "./readyToScreen.js";

/**
 * "Part 1 is finished — screen this person" (Q-AW56).
 *
 * What only this file pins: the recipients are DERIVED from the section matrix (a typed role list
 * beside it is the workaround this repo names), every recipient gets the SAME dedupe key so the
 * ledger tells each person once, the email goes to the org's addresses and nowhere else, and an org
 * that switched notifications off hears nothing on either channel.
 */

const sent = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../../lib/mailer.js", () => ({ sendEmail: sent.fn }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INVITATION = "11111111-2222-4333-8444-555555555555";
const env = () => loadEnv({ NODE_ENV: "test", WEB_APP_URL: "https://app.test" } as NodeJS.ProcessEnv);

const seed = (org: Record<string, unknown> = {}): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      drivers: [{ full_name: "Susan Godfrey" }],
      organizations: [{ notifications_enabled: true, notification_emails: ["office@carrier.test", "owner@carrier.test"], ...org }],
      memberships: [{ user_id: "u-recruiter", role: "recruiter" }, { user_id: "u-admin", role: "admin" }],
    },
    rpc: { emit_notification: "notif-1" },
  });

describe("announcing an applicant who is ready to screen", () => {
  it("tells every member who manages recruitment, once each, under one key", async () => {
    sent.fn.mockReset().mockResolvedValue({ ok: true, provider: "none" });
    const rec = seed();
    const result = await announceReadyToScreen(rec.client, env(), ORG, INVITATION, DRIVER);

    const emits = rec.rpcs().filter((r) => r.fn === "emit_notification");
    expect(emits).toHaveLength(2);
    expect(new Set(emits.map((r) => (r.args as { p_user: string }).p_user))).toEqual(new Set(["u-recruiter", "u-admin"]));
    for (const e of emits) {
      const args = e.args as Record<string, unknown>;
      expect(args.p_org).toBe(ORG);
      expect(args.p_category).toBe("application_ready_to_screen");
      expect(args.p_title).toBe("Susan Godfrey is ready to screen");
      expect(args.p_entity_type).toBe("driver");
      expect(args.p_entity_id).toBe(DRIVER);
      // The INVITATION, not the driver: a re-invited driver who signs again is a new event.
      expect(args.p_dedupe_key).toBe(`application_ready_to_screen:${INVITATION}`);
    }
    expect(result).toEqual({ notified: 2, emailed: true });
    // `organizations` is read by its own primary key, which `expectOrgScoped` knows (`isOrgsOwnKey`).
    expectOrgScoped(rec, ORG);
  });

  it("asks for the recruitment section's managers, derived from the matrix", async () => {
    sent.fn.mockReset().mockResolvedValue({ ok: true, provider: "none" });
    const rec = seed();
    await announceReadyToScreen(rec.client, env(), ORG, INVITATION, DRIVER);
    const q = rec.queries.find((q) => q.table === "memberships")!;
    const roles = q.filters().find((f) => f.col === "role")!.val as string[];
    expect([...roles].sort()).toEqual([...rolesThatManage("recruitment")].sort());
    // Sanity on the matrix itself: a recruiter hears it, a dispatcher does not.
    expect(roles).toContain("recruiter");
    expect(roles).not.toContain("dispatcher");
  });

  it("emails the org's addresses with the board link, and nobody else", async () => {
    sent.fn.mockReset().mockResolvedValue({ ok: true, provider: "none" });
    await announceReadyToScreen(seed().client, env(), ORG, INVITATION, DRIVER);
    expect(sent.fn).toHaveBeenCalledTimes(1);
    const email = sent.fn.mock.calls[0]![1] as { to: string[]; subject: string; text: string; html: string };
    expect(email.to).toEqual(["office@carrier.test", "owner@carrier.test"]);
    expect(email.subject).toBe("Susan Godfrey is ready to screen");
    expect(email.text).toContain("https://app.test/recruitment?waiting=screen");
    expect(email.html).toContain('href="https://app.test/recruitment?waiting=screen"');
  });

  it("sends no email when the org has no addresses, and still notifies", async () => {
    sent.fn.mockReset();
    const rec = seed({ notification_emails: null });
    const result = await announceReadyToScreen(rec.client, env(), ORG, INVITATION, DRIVER);
    expect(sent.fn).not.toHaveBeenCalled();
    expect(result).toEqual({ notified: 2, emailed: false });
  });

  it("is silent on both channels for an org that switched notifications off", async () => {
    sent.fn.mockReset();
    const rec = seed({ notifications_enabled: false });
    const result = await announceReadyToScreen(rec.client, env(), ORG, INVITATION, DRIVER);
    expect(rec.rpcs()).toHaveLength(0);
    expect(sent.fn).not.toHaveBeenCalled();
    expect(result).toEqual({ notified: 0, emailed: false });
  });

  it("never throws into the signature that caused it", async () => {
    sent.fn.mockReset().mockRejectedValue(new Error("smtp down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await announceReadyToScreen(seed().client, env(), ORG, INVITATION, DRIVER);
    expect(result).toEqual({ notified: 0, emailed: false });
    expect(errors).toHaveBeenCalledOnce();
    errors.mockRestore();
  });

  it("escapes the name in the HTML and leaves the text alone", () => {
    const { html, text } = readyToScreenEmail("O'Brien <Susan>", readyToScreenLink(env()));
    expect(html).toContain("O'Brien &lt;Susan&gt;");
    expect(text).toContain("O'Brien <Susan>");
  });
});
