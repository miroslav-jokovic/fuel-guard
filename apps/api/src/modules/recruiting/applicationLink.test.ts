import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../testing/postgrestFixture.js";
import { loadEnv } from "../../env.js";
import { hashInvitationToken } from "./applicationIntake.js";

/**
 * "Send the link again" (C2e: Q-AX5, Q-AX6). What is pinned: a usable invitation keeps its row and
 * gets a new token — never a new, empty application; a revoked or finished one gets a new invitation;
 * the new expiry never shortens the link; the audit carries ids and the expiry and never the token; and
 * the duplicate finder narrows by org, status, name and email.
 */
const mailer = vi.hoisted(() => ({ fn: vi.fn(async () => ({ ok: true, provider: "resend", status: 200 })) }));
vi.mock("../../lib/mailer.js", () => ({ sendEmail: mailer.fn }));

const { createApplicationInvite, findExistingApplicants, isApplicationLinkError, sendApplicationLinkAgain } = await import("./applicationLink.js");

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER = "0f0f0f0f-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INV = "44444444-5555-4666-8777-888888888888";
const NOW = new Date("2026-09-27T12:00:00Z");
const env = loadEnv({ NODE_ENV: "test", MAIL_PROVIDER: "resend", RESEND_API_KEY: "test-key", WEB_APP_URL: "https://app.test" } as NodeJS.ProcessEnv);

const invitation = (over: Record<string, unknown> = {}) => ({
  id: INV, org_id: ORG, driver_id: DRIVER, email: "driver@example.test", expires_at: "2026-09-20T00:00:00Z",
  revoked_at: null, handbook_filed_at: null, created_at: "2026-09-10T00:00:00Z", ...over,
});

const seed = (invitations: Record<string, unknown>[], driver: Record<string, unknown> = {}, settings?: Record<string, unknown>) =>
  createSupabaseRecorder({
    tables: {
      // The carrier's own link lifetime (Q-AW41). Absent: no row, the product's defaults.
      recruiting_settings: settings ? [settings] : [],
      drivers: postgrestFixture([{ id: DRIVER, org_id: ORG, status: "applicant", email: "own@example.test", ...driver }]),
      application_invitations: (q: RecordedQuery) => {
        if (q.write?.method === "update") return [{ ...invitation(), ...(q.write.payload as object) }];
        if (q.write?.method === "insert") return [{ id: "inv-new", ...(q.write.payload as object) }];
        return postgrestFixture(invitations)(q);
      },
      organizations: [{ name: "Silvicom Inc" }],
      audit_logs: [],
    },
  });

const USER = "user-1";
const again = (rec: ReturnType<typeof seed>) =>
  sendApplicationLinkAgain(rec.client, env, { orgId: ORG, userId: USER, driverId: DRIVER }, NOW);

beforeEach(() => mailer.fn.mockClear());

describe("sending the link again", () => {
  it("replaces the token on the same invitation, revives an expired link, and inserts nothing", async () => {
    const rec = seed([invitation()]);
    const out = await again(rec);
    if (!("link" in out)) throw new Error(JSON.stringify(out));
    expect(out.mode).toBe("resent");
    expect(rec.writtenRows("application_invitations").length).toBe(1);
    expect(rec.writes().filter((q) => q.table === "application_invitations").map((q) => q.write?.method)).toEqual(["update"]);

    const update = rec.writes().find((q) => q.table === "application_invitations")!;
    const patch = update.write!.payload as { token_hash: string; expires_at: string };
    // The link returned is the one whose hash was written, and the old link is not it.
    expect(patch.token_hash).toBe(hashInvitationToken(out.link.split("/apply/")[1]!));
    expect(patch.expires_at).toBe("2026-10-11T12:00:00.000Z");
    // Conditional on still being re-sendable, so a revoke that lands first wins.
    expect(update.filters()).toEqual(expect.arrayContaining([
      { col: "org_id", val: ORG }, { col: "id", val: INV }, { col: "revoked_at", val: null }, { col: "handbook_filed_at", val: null },
    ]));
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] });
  });

  it("extends to the carrier's own lifetime when it has chosen one (Q-AW41)", async () => {
    const rec = seed([invitation()], {}, { invite_ttl_days: 5, reminders_enabled: true, reminder_after_hours: 48, updated_at: "2026-09-28T00:00:00Z" });
    await again(rec);
    const patch = rec.writes().find((q) => q.table === "application_invitations")!.write!.payload as { expires_at: string };
    expect(patch.expires_at).toBe("2026-10-02T12:00:00.000Z");
  });

  it("gives a new invitation the carrier's lifetime, unless the drawer overrides it for this link", async () => {
    const created = (days?: number) => {
      const rec = seed([], {}, { invite_ttl_days: 5, reminders_enabled: true, reminder_after_hours: 48, updated_at: "2026-09-28T00:00:00Z" });
      return createApplicationInvite(rec.client, env, { orgId: ORG, userId: USER, driverId: DRIVER, email: null, days })
        .then(() => rec.writtenRows("application_invitations")[0]!.expires_at as string);
    };
    const lifetime = (iso: string) => Math.round((Date.parse(iso) - Date.now()) / 86_400_000);
    expect(lifetime(await created())).toBe(5);
    expect(lifetime(await created(30))).toBe(30);
  });

  it("refuses an override that dies before its driver counts as stopped, and writes nothing (Q-AW51)", async () => {
    const attempt = async (days: number) => {
      const rec = seed([], {}, { invite_ttl_days: 5, reminders_enabled: false, reminder_after_hours: 48, updated_at: "2026-09-28T00:00:00Z" });
      const result = await createApplicationInvite(rec.client, env, { orgId: ORG, userId: USER, driverId: DRIVER, email: null, days });
      return { result, written: rec.writtenRows("application_invitations").length };
    };
    // 2 days is exactly the 48 hours: the link and the alert arrive together, and the sweep skips it.
    const refused = await attempt(2);
    expect(refused.result).toMatchObject({ status: 422, code: "link_shorter_than_delay" });
    expect((refused.result as { message: string }).message).toContain("after 48 hours");
    expect(refused.written).toBe(0);
    const accepted = await attempt(3);
    expect(isApplicationLinkError(accepted.result)).toBe(false);
    expect(accepted.written).toBe(1);
  });

  it("never shortens a link that already outlives the window", async () => {
    const rec = seed([invitation({ expires_at: "2026-12-01T00:00:00Z" })]);
    await again(rec);
    const patch = rec.writes().find((q) => q.table === "application_invitations")!.write!.payload as { expires_at: string };
    expect(patch.expires_at).toBe("2026-12-01T00:00:00Z");
  });

  /** D-AW1: a filed application's link still carries the handbook, so it is re-sent, not replaced. */
  it("re-sends a filed application's link while its handbook is not yet filed", async () => {
    const rec = seed([invitation({ submitted_at: "2026-09-14T00:00:00Z" })]);
    expect(await again(rec)).toMatchObject({ mode: "resent" });
  });

  it("audits the ids and the expiry, never the token or its hash", async () => {
    const rec = seed([invitation()]);
    const out = await again(rec);
    const [audit] = rec.writtenRows("audit_logs");
    expect(audit).toMatchObject({ action: "compliance.application_link_resent", entity_id: INV });
    expect(audit!.meta).toEqual({ driverId: DRIVER, expiresAt: "2026-10-11T12:00:00.000Z" });
    const token = "link" in out ? out.link.split("/apply/")[1]! : "";
    expect(JSON.stringify(audit)).not.toContain(token);
    expect(JSON.stringify(audit)).not.toContain(hashInvitationToken(token));
  });

  it("emails the new link to the invitation's address, saying the old one no longer works", async () => {
    const rec = seed([invitation()]);
    const out = await again(rec);
    const sent = (mailer.fn.mock.calls[0] as unknown as [unknown, { to: string[]; text: string }])[1];
    expect(sent.to).toEqual(["driver@example.test"]);
    expect(sent.text).toContain("link" in out ? out.link : "?");
    expect(sent.text).toContain("no longer works");
  });

  /** The owner's ruling (2026-09-27): a finished or revoked invitation gets a fresh, empty one. */
  it("opens a new invitation when the current one is revoked or its handbook is filed", async () => {
    for (const current of [invitation({ revoked_at: "2026-09-21T00:00:00Z" }), invitation({ handbook_filed_at: "2026-09-22T00:00:00Z" })]) {
      const rec = seed([current]);
      const out = await again(rec);
      expect(out).toMatchObject({ mode: "created" });
      expect(rec.writes().filter((q) => q.table === "application_invitations").map((q) => q.write?.method)).toEqual(["insert"]);
      expect(rec.writtenRows("application_invitations")[0]).toMatchObject({ driver_id: DRIVER, email: "driver@example.test" });
    }
  });

  /** A revoked NEWER invitation does not hide an older live one — the newest UNREVOKED is current. */
  it("re-sends the newest unrevoked invitation, whatever is newer and revoked", async () => {
    const rec = seed([
      invitation({ id: "inv-new-revoked", created_at: "2026-09-25T00:00:00Z", revoked_at: "2026-09-25T01:00:00Z" }),
      invitation(),
    ]);
    expect(await again(rec)).toMatchObject({ mode: "resent" });
  });

  it("addresses a first invitation to the driver's own email", async () => {
    const rec = seed([]);
    expect(await again(rec)).toMatchObject({ mode: "created" });
    expect(rec.writtenRows("application_invitations")[0]).toMatchObject({ email: "own@example.test" });
  });

  it("refuses a driver who is not an applicant, and one in another org", async () => {
    expect(await again(seed([invitation()], { status: "active" }))).toMatchObject({ status: 409, code: "not_an_applicant" });
    expect(await again(seed([invitation()], { org_id: OTHER }))).toMatchObject({ status: 404 });
  });

  it("answers 409 when the invitation changed between the read and the write", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        drivers: [{ id: DRIVER, status: "applicant", email: null }],
        application_invitations: (q: RecordedQuery) => (q.write?.method === "update" ? [] : postgrestFixture([invitation()])(q)),
        organizations: [{ name: "Silvicom Inc" }],
        audit_logs: [],
      },
    });
    expect(await again(rec)).toMatchObject({ status: 409, code: "link_changed" });
    expect(rec.writtenRows("audit_logs")).toEqual([]);
    expect(mailer.fn).not.toHaveBeenCalled();
  });
});

/**
 * C3a: every invitation created from now on is a v2 invitation — it carries its Part 1 row from the first
 * second, because "has a row" is the whole legacy test (plan §7) and a fresh link without one would be read
 * as legacy by the fold, the filing and the page. A re-sent link keeps its invitation, and so its kind.
 */
describe("a new invitation is a v2 invitation (C3a)", () => {
  const create = (rec: ReturnType<typeof createSupabaseRecorder>) =>
    createApplicationInvite(rec.client, env, { orgId: ORG, userId: USER, driverId: DRIVER, email: "driver@example.test" });

  it("mints the new invitation's empty Part 1 row, in its org, and nothing else on it", async () => {
    const rec = seed([]);
    expect(await create(rec)).toMatchObject({ mode: "created" });
    expect(rec.writtenRows("application_intakes")).toEqual([{ org_id: ORG, invitation_id: "inv-new" }]);
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] });
  });

  it("mints one through \"send the link again\" when that opens a new invitation, and none when it re-sends", async () => {
    const created = seed([invitation({ revoked_at: "2026-09-21T00:00:00Z" })]);
    await again(created);
    expect(created.writtenRows("application_intakes")).toEqual([{ org_id: ORG, invitation_id: "inv-new" }]);

    const resent = seed([invitation()]);
    await again(resent);
    expect(resent.writtenRows("application_intakes")).toEqual([]);
  });

  it("revokes the invitation, sends nothing and answers 500 when the row does not land", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        drivers: postgrestFixture([{ id: DRIVER, org_id: ORG, status: "applicant", email: null }]),
        application_invitations: (q: RecordedQuery) =>
          q.write?.method === "insert" ? [{ id: "inv-new", ...(q.write.payload as object) }] : [],
        application_intakes: { data: [], writeError: { code: "42501", message: "denied" } },
        organizations: [{ name: "Silvicom Inc" }],
        audit_logs: [],
      },
    });
    expect(await create(rec)).toMatchObject({ status: 500, code: "db_error" });
    const revoke = rec.writes().find((q) => q.table === "application_invitations" && q.write?.method === "update")!;
    expect(revoke.write!.payload).toMatchObject({ revoked_at: expect.any(String) });
    expect(revoke.filters()).toEqual(expect.arrayContaining([{ col: "id", val: "inv-new" }, { col: "org_id", val: ORG }]));
    expect(mailer.fn).not.toHaveBeenCalled();
  });

  it("treats a row that is already there as minted — a retried create does not fail on its first attempt", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        drivers: postgrestFixture([{ id: DRIVER, org_id: ORG, status: "applicant", email: null }]),
        application_invitations: (q: RecordedQuery) =>
          q.write?.method === "insert" ? [{ id: "inv-new", ...(q.write.payload as object) }] : [],
        application_intakes: { data: [], writeError: { code: "23505", message: "duplicate key" } },
        organizations: [{ name: "Silvicom Inc" }],
        audit_logs: [],
      },
    });
    expect(await create(rec)).toMatchObject({ mode: "created" });
  });
});

describe("finding the applicant already on the board (Q-AX6)", () => {
  const rows = [
    { id: "d-1", org_id: ORG, status: "applicant", full_name: "Marija Varmeda", email: "m@example.test", archived_at: "2026-09-15T00:00:00Z" },
    { id: "d-2", org_id: ORG, status: "applicant", full_name: "Someone Else", email: "M@Example.test", archived_at: null },
    { id: "d-3", org_id: ORG, status: "active", full_name: "Marija Varmeda", email: null, archived_at: null },
    { id: "d-4", org_id: OTHER, status: "applicant", full_name: "Marija Varmeda", email: null, archived_at: null },
    { id: "d-5", org_id: ORG, status: "applicant", full_name: "Marija Varmedax", email: null, archived_at: null },
  ];

  it("matches this org's applicants by full name or email, case-insensitive, archived ones included", async () => {
    const rec = createSupabaseRecorder({ tables: { drivers: postgrestFixture(rows) } });
    const found = await findExistingApplicants(rec.client, ORG, { fullName: " marija varmeda ", email: "m@example.test" });
    expect(found.map((m) => m.id).sort()).toEqual(["d-1", "d-2"]);
    expect(found.find((m) => m.id === "d-1")).toMatchObject({ archived: true });
    expectOrgScoped(rec, ORG);
  });

  it("treats a wildcard in a name as a literal character", async () => {
    const rec = createSupabaseRecorder({ tables: { drivers: postgrestFixture(rows) } });
    expect(await findExistingApplicants(rec.client, ORG, { fullName: "Marija Varmed%", email: null })).toEqual([]);
  });
});
