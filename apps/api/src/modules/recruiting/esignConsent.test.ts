import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ESIGN_CONSENT,
  ESIGN_CONSENT_CLAUSES,
  ESIGN_CONSENT_CLAUSE_CITATIONS,
  esignConsentBody,
} from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { hashInvitationToken, isIntakeError, requireEsignConsent } from "./applicationIntake.js";
import { esignConsentForApplicant, recordEsignConsent } from "./esignConsent.js";

/**
 * The 15 U.S.C. 7001(c) consent (A4).
 *
 * Two things carry this file. The document must actually contain what the statute enumerates — a
 * prose blob missing a clause is the failure mode §390.32(d) would expose years later — and the gate
 * must be armed by A0 rather than by A4, because requiring a consent that cannot yet be recorded
 * would take the live application offline.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const NOW = new Date("2026-08-21T00:00:00Z");
const TOKEN = "d".repeat(43);
const CTX = { ip: "203.0.113.9", userAgent: "Mozilla/5.0" };

const invitation = (over: Record<string, unknown> = {}) => ({
  id: "inv-1",
  org_id: ORG,
  driver_id: DRIVER,
  token_hash: hashInvitationToken(TOKEN),
  expires_at: "2026-09-01T00:00:00Z",
  revoked_at: null,
  consented_at: null,
  releases_completed_at: null,
  submitted_at: null,
  ...over,
});

const seed = (inv: Record<string, unknown> | null = invitation()) =>
  createSupabaseRecorder({
    tables: { application_invitations: inv ? [inv] : [] },
    rpc: { record_esign_consent: { consent_id: "c-1" } },
  });

/** Publish counsel's wording, for one test. The gate opens by itself when the version changes. */
const published = () => vi.spyOn(ESIGN_CONSENT, "version", "get").mockReturnValue("v1");
afterEach(() => vi.restoreAllMocks());

describe("the document says what the statute requires", () => {
  it("carries every clause 7001(c)(1) enumerates", () => {
    // Six, read verbatim from the statute: the paper option, the right to withdraw, the scope, the
    // withdrawal and contact-update procedure, the paper copy afterwards, and the system
    // requirements. A prose blob can be missing one; a record of clauses cannot.
    expect([...ESIGN_CONSENT_CLAUSES]).toEqual([
      "paper_option",
      "withdrawal_right",
      "scope",
      "withdrawal_procedure",
      "paper_copy",
      "system_requirements",
    ]);
    for (const clause of ESIGN_CONSENT_CLAUSES) {
      expect(ESIGN_CONSENT.clauses[clause].length).toBeGreaterThan(20);
      expect(ESIGN_CONSENT_CLAUSE_CITATIONS[clause]).toMatch(/^15 U\.S\.C\. 7001\(c\)/);
    }
  });

  it("composes one stored string, in statutory order, containing every clause", () => {
    const body = esignConsentBody();
    for (const clause of ESIGN_CONSENT_CLAUSES) expect(body).toContain(ESIGN_CONSENT.clauses[clause]);
    // Order matters for a reader with the statute open.
    expect(body.indexOf(ESIGN_CONSENT.clauses.paper_option)).toBeLessThan(
      body.indexOf(ESIGN_CONSENT.clauses.system_requirements),
    );
  });

  it("ships as draft until counsel has read it, like every other instrument", () => {
    expect(esignConsentForApplicant().draft).toBe(true);
  });
});

/**
 * ⚠ The decision this step turns on. D-APP5 says nothing else on the link is reachable until a
 * consent exists — but enforcing that today would refuse every write with no way through, because
 * the document is `v0-draft` and no consent may be recorded against text no lawyer has read. So the
 * gate is tied to the same hazard the signing gate is: it closes by itself when A0 publishes.
 */
describe("the gate is armed by A0, not by A4", () => {
  it("lets the link work while the wording is draft", () => {
    expect(requireEsignConsent(invitation())).toBeNull();
    expect(esignConsentForApplicant().required).toBe(false);
  });

  it("closes on every write path the moment the text is published", () => {
    published();
    const refusal = requireEsignConsent(invitation());
    expect(refusal?.code).toBe("esign_consent_required");
    expect(esignConsentForApplicant().required).toBe(true);
  });

  it("lets a driver who has consented carry on", () => {
    published();
    expect(requireEsignConsent(invitation({ consented_at: "2026-08-21T09:00:00Z" }))).toBeNull();
  });
});

describe("recording it", () => {
  it("refuses to put a real consent under draft wording", async () => {
    const rec = seed();
    const result = await recordEsignConsent(rec.client, TOKEN, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("disclosure_not_final");
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("composes the version, the text and the intent server-side", async () => {
    published();
    const rec = seed();
    const result = await recordEsignConsent(rec.client, TOKEN, CTX, NOW);
    expect(isIntakeError(result)).toBe(false);
    const args = rec.rpcs()[0]!.args as Record<string, unknown>;
    expect(args.p_version).toBe("v1");
    expect(args.p_text).toBe(esignConsentBody());
    expect(args.p_intent).toBe(ESIGN_CONSENT.intent);
    // The org and driver come from the TOKEN, never from a client value.
    expect(args.p_org).toBe(ORG);
    expect(args.p_driver).toBe(DRIVER);
    expect(args.p_ip).toBe("203.0.113.9");
  });

  it("refuses a second consent on the same link", async () => {
    published();
    const rec = seed(invitation({ consented_at: "2026-08-21T09:00:00Z" }));
    const result = await recordEsignConsent(rec.client, TOKEN, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("esign_consent_already_given");
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("turns the transaction's race into the same answer", async () => {
    published();
    const rec = createSupabaseRecorder({
      tables: { application_invitations: [invitation()] },
      rpc: { record_esign_consent: { error: { code: "EC022", message: "esign_consent_already_given" } } },
    });
    const result = await recordEsignConsent(rec.client, TOKEN, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("esign_consent_already_given");
  });

  it("gives a dead link the same neutral refusal as everything else", async () => {
    published();
    const rec = seed(null);
    const result = await recordEsignConsent(rec.client, TOKEN, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("invalid_link");
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("scopes its queries to the org the token resolved to", async () => {
    published();
    const rec = seed();
    await recordEsignConsent(rec.client, TOKEN, CTX, NOW);
    // The invitation lookup is BY HASH — there is no org to filter by until it resolves, which is the
    // point of the design (`publicApplication.ts` never accepts an org from a request).
    expectOrgScoped(rec, ORG, { exempt: ["application_invitations"] });
  });
});
