import { describe, it, expect } from "vitest";
import { SIGN_LINK_UNLOCK_LIMIT } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { hashInvitationToken, isIntakeError, resolveInvitation } from "./applicationIntake.js";
import { unlockDraft } from "./applicationDraft.js";

/**
 * The link the office SENDS for signing (D-AW14, C3s3a): its own 72 hours, and five wrong dates of
 * birth before it stops.
 *
 * What must hold, door by door: the sign door and the text door lapse at `sign_link_expires_at` while
 * the invite door keeps the invitation's expiry; a wrong date on a sent sign link is counted with a
 * conditional UPDATE and says how many are left; the fifth clears both travelling hashes in the SAME
 * write, never `revoked_at`, and audits; the invite door keeps D-APP16's no-counter rule. Since M2a a
 * sign token with no end is dead (§8.6 item 4), and the text door keeps the invitation's expiry until
 * signing is sent.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INV = "11111111-2222-4333-8444-555555555555";
const NOW = new Date("2026-09-28T12:00:00Z");
const INVITE = "i".repeat(43);
const SIGN = "s".repeat(43);
const TEXT = "t".repeat(43);

const invitation = (over: Record<string, unknown> = {}) => ({
  id: INV, org_id: ORG, driver_id: DRIVER,
  token_hash: hashInvitationToken(INVITE), sign_token_hash: hashInvitationToken(SIGN), sms_token_hash: hashInvitationToken(TEXT),
  expires_at: "2026-10-15T00:00:00Z", revoked_at: null,
  consented_at: "2026-09-14T08:00:00Z", releases_completed_at: "2026-09-14T09:00:00Z",
  application_sent_at: "2026-09-15T09:00:00Z", approved_at: "2026-09-20T09:00:00Z",
  signing_opened_at: "2026-09-28T11:00:00Z", submitted_at: null,
  sign_link_expires_at: "2026-10-01T11:00:00Z", unlock_failures: 0,
  ...over,
});

const LOCKED = { payload: { first_name: "Susan", date_of_birth: "1980-04-01" }, furthest_section: "identity", updated_at: "2026-09-20T09:00:00Z" };

/**
 * `updates`: what each UPDATE of the invitation answers, in order — `[]` is a conditional UPDATE that
 * matched nothing (a lost race). `reread`: the count a re-read after a lost race finds.
 */
const seed = (opts: { inv?: Record<string, unknown>; updates?: unknown[][]; reread?: number; writeError?: boolean } = {}) => {
  const updates = [...(opts.updates ?? [])];
  return createSupabaseRecorder({
    tables: {
      application_invitations: (q: RecordedQuery) => {
        if (q.write) {
          if (opts.writeError) return { data: null, error: { message: "boom" } };
          return updates.length > 0 ? updates.shift()! : [{ id: INV }];
        }
        if (q.ops.some((o) => o.method === "or")) return [invitation(opts.inv)];
        return [{ unlock_failures: opts.reread ?? 0 }];
      },
      application_drafts: [LOCKED],
      application_intakes: [],
      application_intake_licences: [],
      drivers: [],
      audit_logs: [],
    },
  });
};

const invitationWrites = (rec: ReturnType<typeof seed>) =>
  rec.writes().filter((q) => q.table === "application_invitations");

describe("the sent sign link's 72 hours", () => {
  const after = new Date("2026-10-01T11:00:01Z");

  it("closes the sign door and the text door at the send's end, while the invitation lives on", async () => {
    for (const token of [SIGN, TEXT]) {
      const live = await resolveInvitation(seed().client, token, NOW);
      expect(isIntakeError(live)).toBe(false);
      const dead = await resolveInvitation(seed().client, token, after);
      expect(isIntakeError(dead) && dead.code).toBe("invalid_link");
    }
  });

  it("leaves the invite door on the invitation's own expiry", async () => {
    const r = await resolveInvitation(seed().client, INVITE, after);
    expect(isIntakeError(r)).toBe(false);
    expect(!isIntakeError(r) && r.door).toBe("invite");
  });

  it("refuses a sign token with no end of its own, even while the invitation lives (M2a)", async () => {
    const r = await resolveInvitation(seed({ inv: { sign_link_expires_at: null } }).client, SIGN, NOW);
    expect(isIntakeError(r) && r.code).toBe("invalid_link");
  });

  it("leaves the text door on the invitation's expiry until signing is sent — the application's texts carry it", async () => {
    const r = await resolveInvitation(seed({ inv: { sign_link_expires_at: null } }).client, TEXT, after);
    expect(!isIntakeError(r) && r.door).toBe("text");
  });

  it("names the door each token came through", async () => {
    const doors = await Promise.all([INVITE, SIGN, TEXT].map(async (t) => {
      const r = await resolveInvitation(seed().client, t, NOW);
      return isIntakeError(r) ? null : r.door;
    }));
    expect(doors).toEqual(["invite", "sign", "text"]);
  });

  /** ⚠ The recorder hands back whole rows, so only this sees an unselected column read `undefined`. */
  it("asks PostgREST for the end and the count", async () => {
    const rec = seed();
    await resolveInvitation(rec.client, SIGN, NOW);
    const cols = String(rec.forTable("application_invitations")[0]!.ops.find((o) => o.method === "select")!.args[0]);
    expect(cols).toContain("sign_link_expires_at");
    expect(cols).toContain("unlock_failures");
  });
});

describe("wrong dates of birth on a sent sign link", () => {
  it("counts a wrong answer with a conditional UPDATE, and says how many are left", async () => {
    const rec = seed({ inv: { unlock_failures: 2 } });
    const r = await unlockDraft(rec.client, SIGN, "1980-04-02", NOW);
    expect(isIntakeError(r) ? r.code : { locked: r.locked, left: r.attemptsLeft }).toEqual({ locked: true, left: 2 });
    const [w] = invitationWrites(rec);
    expect(w!.write!.payload).toEqual({ unlock_failures: 3 });
    expect(w!.filters()).toEqual(expect.arrayContaining([
      { col: "org_id", val: ORG }, { col: "id", val: INV }, { col: "unlock_failures", val: 2 },
    ]));
  });

  it("counts on the text door too", async () => {
    const rec = seed();
    const r = await unlockDraft(rec.client, TEXT, "1980-04-02", NOW);
    expect(!isIntakeError(r) && r.attemptsLeft).toBe(SIGN_LINK_UNLOCK_LIMIT - 1);
  });

  it("stops the link on the fifth: both travelling hashes cleared in the counting write, never revoked, audited", async () => {
    const rec = seed({ inv: { unlock_failures: 4 } });
    const r = await unlockDraft(rec.client, SIGN, "1980-04-02", NOW);
    expect(isIntakeError(r) && r.code).toBe("sign_link_locked");
    const writes = invitationWrites(rec);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.write!.payload).toEqual({ unlock_failures: 5, sign_token_hash: null, sms_token_hash: null });
    expect(JSON.stringify(writes[0]!.write!.payload)).not.toContain("revoked_at");
    const [audit] = rec.writtenRows("audit_logs");
    expect(audit).toMatchObject({ action: "compliance.sign_link_locked", entity_id: INV });
    expect(JSON.stringify(audit)).not.toContain("1980");
  });

  it("counts both of two wrong answers that race: the loser re-reads and counts on top", async () => {
    const rec = seed({ inv: { unlock_failures: 1 }, updates: [[], [{ id: INV }]], reread: 2 });
    const r = await unlockDraft(rec.client, SIGN, "1980-04-02", NOW);
    expect(!isIntakeError(r) && r.attemptsLeft).toBe(2);
    const writes = invitationWrites(rec);
    expect(writes.map((w) => w.write!.payload)).toEqual([{ unlock_failures: 2 }, { unlock_failures: 3 }]);
    expect(writes[1]!.filters()).toContainEqual({ col: "unlock_failures", val: 2 });
  });

  it("does not stop the link twice when it lost the race to the answer that stopped it", async () => {
    const rec = seed({ inv: { unlock_failures: 4 }, updates: [[]], reread: 5 });
    const r = await unlockDraft(rec.client, SIGN, "1980-04-02", NOW);
    expect(isIntakeError(r) && r.code).toBe("sign_link_locked");
    expect(invitationWrites(rec)).toHaveLength(1);
    expect(rec.writtenRows("audit_logs")).toHaveLength(0);
  });

  it("refuses rather than let an uncounted guess through when the count cannot be written", async () => {
    const r = await unlockDraft(seed({ writeError: true }).client, SIGN, "1980-04-02", NOW);
    expect(isIntakeError(r) && r.code).toBe("unlock_failed");
  });

  it("counts nothing for the right answer", async () => {
    const rec = seed({ inv: { unlock_failures: 3 } });
    const r = await unlockDraft(rec.client, SIGN, "1980-04-01", NOW);
    expect(!isIntakeError(r) && r.locked).toBe(false);
    expect(invitationWrites(rec)).toHaveLength(0);
  });

  it("scopes every query to the invitation's org", async () => {
    const rec = seed({ inv: { unlock_failures: 4 } });
    await unlockDraft(rec.client, SIGN, "1980-04-02", NOW);
    // The token lookup is what FINDS the org, so it alone may not carry it.
    expectOrgScoped(rec, ORG, { exempt: ["application_invitations"] });
    for (const w of invitationWrites(rec)) expect(w.filters()).toContainEqual({ col: "org_id", val: ORG });
  });
});

describe("links that keep D-APP16's rule", () => {
  it("counts nothing on the invite door, and says nothing about tries", async () => {
    const rec = seed({ inv: { unlock_failures: 4 } });
    const r = await unlockDraft(rec.client, INVITE, "1980-04-02", NOW);
    expect(!isIntakeError(r) && r.locked).toBe(true);
    expect(!isIntakeError(r) && r.attemptsLeft).toBeUndefined();
    expect(invitationWrites(rec)).toHaveLength(0);
  });

  it("counts nothing on a text link before signing is sent", async () => {
    const rec = seed({ inv: { sign_link_expires_at: null } });
    const r = await unlockDraft(rec.client, TEXT, "1980-04-02", NOW);
    expect(!isIntakeError(r) && r.attemptsLeft).toBeUndefined();
    expect(invitationWrites(rec)).toHaveLength(0);
  });
});
