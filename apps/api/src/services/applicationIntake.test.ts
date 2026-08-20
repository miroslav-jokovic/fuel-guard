import { describe, it, expect } from "vitest";
import { loadEnv } from "../env.js";
import { createSupabaseRecorder } from "../testing/supabaseRecorder.js";
import {
  hashInvitationToken,
  isIntakeError,
  mintInvitationToken,
  recordRelease,
  resolveInvitation,
  sealSsn,
  submitApplication,
} from "./applicationIntake.js";

/**
 * The unauthenticated intake. The token is the ENTIRE access-control story here, so most of what is
 * pinned below is about what a caller holding a bad one learns: nothing, in every case, and always
 * the same nothing.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const NOW = new Date("2026-08-20T00:00:00Z");
const env = (over: Record<string, string> = {}) => loadEnv({ NODE_ENV: "test", ...over } as NodeJS.ProcessEnv);

const TOKEN = "a".repeat(43);
const invitation = (over: Record<string, unknown> = {}) => ({
  id: "inv-1",
  org_id: ORG,
  driver_id: DRIVER,
  token_hash: hashInvitationToken(TOKEN),
  expires_at: "2026-09-01T00:00:00Z",
  used_at: null,
  revoked_at: null,
  ...over,
});

const seed = (inv: Record<string, unknown> | null = invitation()) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: inv ? [inv] : [],
      organizations: [{ name: "Silvicom" }],
      driver_authorizations: [{ id: "auth-1" }],
    },
    rpc: { submit_driver_application: { application_id: "app-1" } },
  });

const APPLICATION = {
  application: {
    first_name: "Susan", last_name: "Godfrey", date_of_birth: "1980-04-01",
    email: "s@example.test", phone: "555-0111", addresses: [],
    cdl_number: "PA334554", cdl_state: "PA", cdl_expires_at: "2029-01-01",
    accidents: [], declares_no_accidents: true,
    violations: [], declares_no_violations: true,
    licence_ever_denied: false,
    employers: [], declares_no_employment: true,
    certified: true as const, signed_name: "Susan Godfrey",
  },
  ssn: null,
} as unknown as Parameters<typeof submitApplication>[3];

const CTX = { ip: "203.0.113.9", userAgent: "Mozilla/5.0" };

describe("the token", () => {
  it("is 256 bits and stored only as a hash", () => {
    const { token, hash } = mintInvitationToken();
    // 32 random bytes, base64url — no padding, 43 characters.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(mintInvitationToken().token).not.toBe(token);
  });

  it("is never sent to the database in the clear", async () => {
    const rec = seed();
    await resolveInvitation(rec.client, TOKEN, NOW);
    const filters = JSON.stringify(rec.forTable("application_invitations")[0]!.filters());
    expect(filters).toContain(hashInvitationToken(TOKEN));
    expect(filters).not.toContain(TOKEN);
  });
});

/**
 * Expired, revoked, spent, never existed — one refusal, one message. Telling them apart would let an
 * anonymous caller learn that a token EXISTED, which is a fact about a person applying for a job.
 */
describe("every bad link fails the same way", () => {
  const cases: Array<[string, Record<string, unknown> | null]> = [
    ["no such invitation", null],
    ["already used", invitation({ used_at: "2026-08-19T00:00:00Z" })],
    ["revoked", invitation({ revoked_at: "2026-08-19T00:00:00Z" })],
    ["expired", invitation({ expires_at: "2026-08-01T00:00:00Z" })],
  ];

  it.each(cases)("refuses %s with the same code and message", async (_label, inv) => {
    const result = await resolveInvitation(seed(inv).client, TOKEN, NOW);
    expect(isIntakeError(result) && result.code).toBe("invalid_link");
    expect(isIntakeError(result) && result.message).toBe(
      "This application link is not valid. Ask for a new one.",
    );
  });

  it("files nothing when the link is dead", async () => {
    const rec = seed(null);
    await submitApplication(rec.client, env(), TOKEN, APPLICATION, CTX, NOW);
    expect(rec.rpcs()).toHaveLength(0);
  });
});

describe("submitting", () => {
  it("hands the transaction the org and driver the TOKEN resolved to, never a client value", async () => {
    const rec = seed();
    const result = await submitApplication(rec.client, env(), TOKEN, APPLICATION, CTX, NOW);
    expect(isIntakeError(result)).toBe(false);
    const args = rec.rpcs()[0]!.args as Record<string, unknown>;
    expect(args.p_org).toBe(ORG);
    expect(args.p_driver).toBe(DRIVER);
    expect(args.p_invitation).toBe("inv-1");
    // ESIGN attribution evidence, the same three facts 0215 records for a staff-recorded signature.
    expect(args.p_ip).toBe("203.0.113.9");
    expect(args.p_user_agent).toBe("Mozilla/5.0");
  });

  it("turns the transaction's spent-link race into the same neutral refusal", async () => {
    const rec = createSupabaseRecorder({
      tables: { application_invitations: [invitation()], organizations: [{ name: "S" }] },
      rpc: { submit_driver_application: { error: { code: "DA021", message: "application_invitation_spent" } } },
    });
    const result = await submitApplication(rec.client, env(), TOKEN, APPLICATION, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("invalid_link");
  });
});

/**
 * D-HIRE6. The last four may be stored; the full value may be sealed and may not be stored any other
 * way. A deployment with no encryption key must not become the deployment that keeps nine digits
 * readable — it keeps four.
 */
describe("the Social Security number", () => {
  it("seals the full value and keeps the last four", () => {
    const configured = env({ SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") });
    const { last4, sealed } = sealSsn(configured, ORG, "123456789");
    expect(last4).toBe("6789");
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain("123456789");
  });

  it("drops the full value rather than storing it in the clear when sealing is unavailable", () => {
    const { last4, sealed } = sealSsn(env(), ORG, "123456789");
    expect(last4).toBe("6789");
    expect(sealed).toBeNull();
  });

  it("stores nothing at all when the applicant gave nothing", () => {
    expect(sealSsn(env(), ORG, null)).toEqual({ last4: null, sealed: null });
  });

  it("never sends the number to the transaction", async () => {
    const rec = seed();
    await submitApplication(rec.client, env(), TOKEN, { ...APPLICATION, ssn: "123456789" }, CTX, NOW);
    expect(JSON.stringify(rec.rpcs()[0]!.args)).not.toContain("123456789");
  });
});

/**
 * The gate that keeps a real signature off placeholder wording (Q-H3). Tied to the version string,
 * so it opens by itself when counsel's text lands rather than waiting for somebody to clear a flag.
 */
describe("signing a release", () => {
  it("refuses while the disclosure is draft wording, and says why", async () => {
    const rec = seed();
    const result = await recordRelease(
      rec.client, TOKEN, { purpose: "psp", signed_name: "Susan Godfrey", esign_consent: true }, CTX, NOW,
    );
    expect(isIntakeError(result) && result.code).toBe("disclosure_not_final");
    expect(rec.writtenRows("driver_authorizations")).toHaveLength(0);
  });

  it("refuses a release on a dead link before it looks at the wording", async () => {
    const result = await recordRelease(
      seed(null).client, TOKEN, { purpose: "psp", signed_name: "S", esign_consent: true }, CTX, NOW,
    );
    expect(isIntakeError(result) && result.code).toBe("invalid_link");
  });
});
