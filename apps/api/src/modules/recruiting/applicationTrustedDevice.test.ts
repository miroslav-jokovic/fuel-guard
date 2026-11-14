import { describe, expect, it } from "vitest";
import { DEVICE_TOKEN_PATTERN, TRUSTED_DEVICE_MAX } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { hashInvitationToken, isIntakeError } from "./applicationIntake.js";
import { unlockDraft, unlockWithDevice } from "./applicationDraft.js";
import { hashUnlockCode, unlockWithCode } from "./applicationUnlockCode.js";
import { hashDeviceToken, mintDeviceToken, rememberDevice } from "./applicationTrustedDevice.js";

/**
 * A phone that proved the date of birth once is not asked again (U2, 0604).
 *
 * What must hold: a device is remembered only by a RIGHT answer that asked for it — never by a wrong one,
 * never by an unlock with nothing gated (a token from before a date of birth exists would open the
 * application once one does); only the token's hash is stored, salted by the invitation; remembering
 * never fails the unlock it rides on; a live token of THIS invitation releases what the date of birth
 * would, and an unknown, expired or other application's token releases nothing; every query is scoped
 * to the invitation's org.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INV = "11111111-2222-4333-8444-555555555555";
const OTHER_INV = "99999999-2222-4333-8444-555555555555";
const TOKEN = "i".repeat(43);
const NOW = new Date("2026-11-14T15:00:00Z");
const DEVICE = "d".repeat(43);

const invitation = {
  id: INV, org_id: ORG, driver_id: DRIVER, token_hash: hashInvitationToken(TOKEN), sign_token_hash: null, sms_token_hash: null,
  expires_at: "2026-12-01T00:00:00Z", revoked_at: null, consented_at: "2026-11-01T00:00:00Z", unlock_failures: 0,
};
const LOCKED_DRAFT = { payload: { first_name: "Susan", date_of_birth: "1980-04-01" }, furthest_section: "identity", updated_at: "2026-11-09T09:00:00Z", revision: 3 };
const OPEN_DRAFT = { payload: { first_name: "Susan" }, furthest_section: "identity", updated_at: "2026-11-09T09:00:00Z", revision: 1 };

const device = (over: Record<string, unknown> = {}) => ({
  id: "dev-1", token_hash: hashDeviceToken(INV, DEVICE), expires_at: "2026-12-14T15:00:00+00:00", ...over,
});

const seed = (opts: { draft?: unknown[]; devices?: unknown[]; insertFails?: boolean; inv?: unknown[]; codes?: unknown[] } = {}) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: opts.inv ?? [invitation],
      application_drafts: opts.draft ?? [LOCKED_DRAFT],
      application_intakes: [],
      application_intake_licences: [],
      application_ssns: [],
      drivers: [],
      audit_logs: [],
      application_unlock_codes: (q: RecordedQuery) => (q.write ? [{ id: "c-1" }] : (opts.codes ?? [])),
      application_trusted_devices: (q: RecordedQuery) => {
        if (q.write?.method === "insert") return opts.insertFails ? { data: null, error: { code: "42P01", message: "relation does not exist" } } : [];
        if (q.write) return [];
        return opts.devices ?? [];
      },
    },
  });

const made = (rec: ReturnType<typeof seed>) =>
  rec.writes().filter((q) => q.table === "application_trusted_devices" && q.write?.method === "insert");
const audits = (rec: ReturnType<typeof seed>) =>
  rec.writes().filter((q) => q.table === "audit_logs").map((q) => q.write?.payload as Record<string, unknown>);

describe("remembering a device", () => {
  it("a right date of birth that asked for it leaves a token, stores only its hash for 30 days, and audits without it", async () => {
    const rec = seed();
    const view = await unlockDraft(rec.client, TOKEN, "1980-04-01", NOW, true);
    if (isIntakeError(view)) throw new Error(view.code);
    expect(view.locked).toBe(false);
    expect(view.deviceToken).toMatch(DEVICE_TOKEN_PATTERN);

    const [row] = made(rec);
    expect(row!.write!.payload).toEqual({
      org_id: ORG, invitation_id: INV, token_hash: hashDeviceToken(INV, view.deviceToken!), earned_by: "date_of_birth",
      expires_at: "2026-12-14T15:00:00.000Z", created_at: NOW.toISOString(),
    });
    expect(JSON.stringify(rec.writes())).not.toContain(view.deviceToken!);
    const audit = audits(rec).find((a) => a.action === "compliance.device_remembered")!;
    expect(audit.meta).toEqual({ driverId: DRIVER, earnedBy: "date_of_birth" });
    // The token lookup is what FINDS the org, so it is the one read that cannot filter on it.
    expectOrgScoped(rec, ORG, { exempt: ["application_invitations"] });
  });

  it("a right date of birth that did not ask leaves nothing", async () => {
    const rec = seed();
    const view = await unlockDraft(rec.client, TOKEN, "1980-04-01", NOW);
    expect(view).not.toHaveProperty("deviceToken");
    expect(made(rec)).toHaveLength(0);
  });

  it("⚠ a wrong date of birth leaves nothing, whatever it asked", async () => {
    const rec = seed();
    const view = await unlockDraft(rec.client, TOKEN, "1981-04-01", NOW, true);
    expect(view).toMatchObject({ locked: true, payload: null });
    expect(view).not.toHaveProperty("deviceToken");
    expect(made(rec)).toHaveLength(0);
  });

  it("⚠ an unlock with nothing gated yet leaves nothing — a token from before a date of birth would open it later", async () => {
    const rec = seed({ draft: [OPEN_DRAFT] });
    const view = await unlockDraft(rec.client, TOKEN, "1980-04-01", NOW, true);
    expect(view).toMatchObject({ locked: false });
    expect(view).not.toHaveProperty("deviceToken");
    expect(made(rec)).toHaveLength(0);
  });

  it("a right code that asked for it leaves a token earned by the code", async () => {
    const rec = seed({ codes: [{ id: "c-1", code_hash: hashUnlockCode(INV, "123456"), expires_at: "2026-11-14T15:10:00Z", attempts: 0, used_at: null }] });
    const view = await unlockWithCode(rec.client, TOKEN, "123456", NOW, true);
    if (isIntakeError(view)) throw new Error(view.code);
    expect(view.deviceToken).toMatch(DEVICE_TOKEN_PATTERN);
    expect(made(rec)[0]!.write!.payload).toMatchObject({ earned_by: "code" });
  });

  it("stops at the cap of live devices, and still opens the application", async () => {
    const full = Array.from({ length: TRUSTED_DEVICE_MAX }, (_, i) => device({ id: `dev-${i}`, token_hash: String(i).repeat(64) }));
    const rec = seed({ devices: full });
    const view = await unlockDraft(rec.client, TOKEN, "1980-04-01", NOW, true);
    expect(view).toMatchObject({ locked: false, payload: LOCKED_DRAFT.payload });
    expect(view).not.toHaveProperty("deviceToken");
    expect(made(rec)).toHaveLength(0);
  });

  it("does not count a device that has run out against the cap", async () => {
    const stale = Array.from({ length: TRUSTED_DEVICE_MAX }, (_, i) =>
      device({ id: `dev-${i}`, token_hash: String(i).repeat(64), expires_at: "2026-11-14T14:59:59+00:00" }));
    const rec = seed({ devices: stale });
    const view = await unlockDraft(rec.client, TOKEN, "1980-04-01", NOW, true);
    expect(view).toHaveProperty("deviceToken");
  });

  it("⚠ never fails the unlock when the row cannot be written (the table not there yet)", async () => {
    const rec = seed({ insertFails: true });
    const view = await unlockDraft(rec.client, TOKEN, "1980-04-01", NOW, true);
    expect(view).toMatchObject({ locked: false, payload: LOCKED_DRAFT.payload });
    expect(view).not.toHaveProperty("deviceToken");
    expect(audits(rec).some((a) => a.action === "compliance.device_remembered")).toBe(false);
  });

  it("mints 43 characters of base64url, different every time", () => {
    const a = mintDeviceToken();
    expect(a).toMatch(DEVICE_TOKEN_PATTERN);
    expect(mintDeviceToken()).not.toBe(a);
  });

  it("uses the mint it is given", async () => {
    const rec = seed();
    expect(await rememberDevice(rec.client, invitation, "date_of_birth", NOW, () => DEVICE)).toBe(DEVICE);
  });
});

describe("opening with a remembered device", () => {
  it("releases what the date of birth would, and stamps the visit", async () => {
    const rec = seed({ devices: [device()] });
    const view = await unlockWithDevice(rec.client, TOKEN, DEVICE, NOW);
    expect(view).toMatchObject({ locked: false, payload: LOCKED_DRAFT.payload, revision: 3 });
    const stamp = rec.writes().find((q) => q.table === "application_trusted_devices" && q.write?.method === "update")!;
    expect(stamp.write!.payload).toEqual({ last_used_at: NOW.toISOString() });
    expectOrgScoped(rec, ORG, { exempt: ["application_invitations"] });
  });

  it("⚠ opens nothing for a token the invitation does not hold", async () => {
    const rec = seed({ devices: [device()] });
    const view = await unlockWithDevice(rec.client, TOKEN, "x".repeat(43), NOW);
    expect(isIntakeError(view) && view.code).toBe("device_not_known");
    expect(rec.writes().filter((q) => q.table === "application_trusted_devices")).toHaveLength(0);
  });

  it("⚠ opens nothing for a token that has run out, to the second", async () => {
    const rec = seed({ devices: [device({ expires_at: "2026-11-14T15:00:00+00:00" })] });
    const view = await unlockWithDevice(rec.client, TOKEN, DEVICE, NOW);
    expect(isIntakeError(view) && view.code).toBe("device_not_known");
  });

  it("⚠ opens nothing for another application's token: the hash is salted by the invitation", async () => {
    const rec = seed({ devices: [device({ token_hash: hashDeviceToken(OTHER_INV, DEVICE) })] });
    const view = await unlockWithDevice(rec.client, TOKEN, DEVICE, NOW);
    expect(isIntakeError(view) && view.code).toBe("device_not_known");
  });

  it("opens nothing on a link that does not resolve, whatever the token", async () => {
    const rec = seed({ inv: [], devices: [device()] });
    const view = await unlockWithDevice(rec.client, TOKEN, DEVICE, NOW);
    expect(isIntakeError(view) && view.code).toBe("invalid_link");
  });
});
