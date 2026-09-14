import { describe, it, expect, vi, afterEach } from "vitest";
import {
  DISCLOSURES,
  ESIGN_CONSENT,
  ESIGN_CONSENT_CLAUSES,
  ESIGN_CONSENT_CLAUSE_CITATIONS,
  carrierWording,
  esignConsentBody,
  type CarrierWording,
} from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { hashInvitationToken, isIntakeError, requireEsignConsent } from "./applicationIntake.js";
import { esignConsentForApplicant, recordEsignConsent } from "./esignConsent.js";
import { ESIGN_VERSION } from "./defaultWording.js";

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
    // ⚠ `organizations` since D-WORD1: `loadCarrierWording` reads the carrier's name to fill the
    // "I authorize ___" blanks in FMCSA's forms, so a fixture without one is a carrier with no name.
    tables: { application_invitations: inv ? [inv] : [], organizations: [{ name: "Silvicom Inc" }] },
    rpc: { record_esign_consent: { consent_id: "c-1" } },
  });

/** Publish counsel's wording, for one test. The gate opens by itself when the version changes. */
const published = () => vi.spyOn(ESIGN_CONSENT, "version", "get").mockReturnValue("v1");

/**
 * The same thing, as PRODUCTION does it: a row in `org_disclosures`, through the overlay the api
 * reads it with.
 *
 * ⚠ Both helpers exist on purpose and they are not interchangeable. `published()` mocks the code
 * constant, which is right for `esignConsentForApplicant()` and `recordEsignConsent` because those
 * read the constant. `requireEsignConsent` reads the CARRIER's documents, and since 0338 a carrier
 * publishes rows — the constant stays `v0-draft` for ever. Mocking it for this gate would pin a path
 * production cannot take, which is exactly how the gate came to be a no-op on three write paths from
 * A4 until 2026-09-13.
 */
/**
 * ⚠ The code's `v0-draft` placeholders, kept as this file's base on purpose. Since D-WORD1 the api
 * passes `defaultWording()` — which is not draft — so a test built on that base could no longer
 * exercise the "gate is armed by A0" branch at all. Here the base stays draft, and the two tests
 * below keep proving both sides of the gate.
 */
const CODE_BASE: CarrierWording = { disclosures: DISCLOSURES, esignConsent: ESIGN_CONSENT };

const publishedWording = (): CarrierWording =>
  carrierWording([{
    instrument: "esign_consent",
    version: "v1",
    title: ESIGN_CONSENT.title,
    body: esignConsentBody(),
    clauses: ESIGN_CONSENT.clauses,
    intent: ESIGN_CONSENT.intent,
    publishedAt: "2026-09-13T10:00:00Z",
  }], CODE_BASE);

/** A carrier that has published nothing — six placeholders, which is every carrier today. */
const draftWording = (): CarrierWording => carrierWording([], CODE_BASE);
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
    expect(requireEsignConsent(invitation(), draftWording())).toBeNull();
    expect(esignConsentForApplicant().required).toBe(false);
  });

  it("closes on every write path the moment the text is published", () => {
    published();
    const refusal = requireEsignConsent(invitation(), publishedWording());
    expect(refusal?.code).toBe("esign_consent_required");
    expect(esignConsentForApplicant().required).toBe(true);
  });

  it("lets a driver who has consented carry on", () => {
    published();
    expect(
      requireEsignConsent(invitation({ consented_at: "2026-08-21T09:00:00Z" }), publishedWording()),
    ).toBeNull();
  });
});

describe("recording it", () => {
  /**
   * ⚠ The refusal is still here and still reachable — `recordEsignConsent` reads the CARRIER's
   * wording, so it refuses whenever that resolves to a draft. Since D-WORD1 the shipped catalogue
   * never does, so the state has to be built rather than found: this seeds an `org_disclosures`
   * override that is itself draft, which is the one way a real carrier could still get there.
   */
  it("refuses to put a real consent under draft wording", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        application_invitations: [invitation()],
        organizations: [{ name: "Silvicom Inc" }],
        org_disclosures: [{
          instrument: "esign_consent", version: "v0-draft", title: "Draft consent",
          body: "draft", clauses: Object.fromEntries(ESIGN_CONSENT_CLAUSES.map((c) => [c, "draft"])),
          intent: "draft", published_at: "2026-09-14T09:00:00Z", published_by: null,
        }],
      },
      rpc: { record_esign_consent: { consent_id: "c-1" } },
    });
    const result = await recordEsignConsent(rec.client, TOKEN, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("disclosure_not_final");
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("composes the version, the text and the intent server-side", async () => {
    const rec = seed();
    const result = await recordEsignConsent(rec.client, TOKEN, CTX, NOW);
    expect(isIntakeError(result)).toBe(false);
    const args = rec.rpcs()[0]!.args as Record<string, unknown>;
    // Provenance, not a counter — the statute and the date it was read off it.
    expect(args.p_version).toBe(ESIGN_VERSION);
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
    const rec = seed();
    await recordEsignConsent(rec.client, TOKEN, CTX, NOW);
    // The invitation lookup is BY HASH — there is no org to filter by until it resolves, which is the
    // point of the design (`publicApplication.ts` never accepts an org from a request). And
    // `organizations` is filtered on its own primary key, which the recorder cannot see as scoping.
    expectOrgScoped(rec, ORG, { exempt: ["application_invitations", "organizations"] });
  });
});
