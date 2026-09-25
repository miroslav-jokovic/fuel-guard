import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { hashInvitationToken, isIntakeError } from "./applicationIntake.js";
import { applicantHandbookPdf, recordHandbookMark } from "./handbookCeremony.js";
import { HANDBOOK_VERSION } from "./applicationPdf/handbook/handbookText.js";
import { pdfText } from "../../testing/pdfText.js";

/**
 * The driver's half of the handbook, on their own link (HANDBOOK-SIGNING-PLAN.md, D-HB1).
 *
 * ⚠ What is worth pinning: the order the office sets (filed → opened → not yet filed), that a place
 * is signed with the signature the driver ALREADY adopted and never a new one, and that every refusal
 * but a dead link reads "not now".
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const TOKEN = "t".repeat(43);
const NOW = new Date("2026-09-25T15:00:00Z");
const CTX = { ip: "203.0.113.9", userAgent: "vitest" };

const invitation = (over: Record<string, unknown> = {}) => ({
  id: "inv-1", org_id: ORG, driver_id: DRIVER, token_hash: hashInvitationToken(TOKEN),
  expires_at: "2099-01-01T00:00:00Z", revoked_at: null, consented_at: "2026-09-14T08:00:00Z",
  submitted_at: "2026-09-25T10:00:00Z", handbook_signing_opened_at: "2026-09-25T11:00:00Z", handbook_filed_at: null,
  ...over,
});

const seed = (over: { inv?: Record<string, unknown>; adopted?: string | null; writeError?: unknown; places?: string[] } = {}) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: [invitation(over.inv)],
      org_disclosures: [],
      // The packet's adopted signature: one `signature` mark is enough for `adoptedPacketMarks`.
      application_packet_marks: over.adopted === null ? [] : [{ mark: "signature", signed_name: over.adopted ?? "Jovana Petrović" }],
      handbook_marks: (q: RecordedQuery) =>
        q.write
          ? (over.writeError ? { writeError: over.writeError } : [])
          : (over.places ?? []).map((placement_id) => ({
              placement_id,
              signed_name: placement_id === "h4c" ? "Miroslav Jokovic" : "Jovana Petrović",
              signed_at: "2026-09-25T11:05:00Z",
              representative_id: null,
            })),
      drivers: [{ full_name: "Jovana Petrović-Szczepańska" }],
      driver_applications: [{ ssn_last4: "1234" }],
      organizations: [{ name: "Silvicom Inc", legal_address: null }],
      application_captures: [],
      qualification_records: [],
      documents: [],
    },
    storage: { download: async () => ({ data: null, error: { message: "none" } }) },
  });

const MARK = { placement_id: "h3" as const, esign_consent: true as const };

describe("signing a place", () => {
  it("signs with the adopted name, the place's own sentence, the text version and the address", async () => {
    const rec = seed({ places: ["h3"] });
    const result = await recordHandbookMark(rec.client, TOKEN, MARK, CTX, NOW);
    expect(isIntakeError(result)).toBe(false);
    const row = rec.writtenRows("handbook_marks")[0]!;
    expect(row).toMatchObject({
      placement_id: "h3", party: "driver", signed_name: "Jovana Petrović",
      affirmed: "By signing this, I agree to safety penalty policy.", handbook_version: HANDBOOK_VERSION,
      signed_ip: "203.0.113.9", signed_user_agent: "vitest",
    });
    expect(row.representative_id).toBeUndefined();
    // The invitation is found by its token hash (that IS the scope), and `organizations` is the org's
    // own row, keyed by its id — neither has an `org_id` to filter on.
    expectOrgScoped(rec, ORG, { exempt: ["application_invitations", "organizations"] });
  });

  it("refuses before the application is filed", async () => {
    const result = await recordHandbookMark(seed({ inv: { submitted_at: null } }).client, TOKEN, MARK, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("handbook_application_not_filed");
  });

  it("refuses before the office opens it, and says where it is opened", async () => {
    const result = await recordHandbookMark(seed({ inv: { handbook_signing_opened_at: null } }).client, TOKEN, MARK, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("handbook_not_opened");
    expect(isIntakeError(result) && result.message).toMatch(/in their office/);
  });

  it("refuses once it is filed", async () => {
    const result = await recordHandbookMark(seed({ inv: { handbook_filed_at: "2026-09-25T12:00:00Z" } }).client, TOKEN, MARK, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("handbook_already_filed");
  });

  it("refuses when there is no adopted signature, rather than inventing one", async () => {
    const rec = seed({ adopted: null });
    const result = await recordHandbookMark(rec.client, TOKEN, MARK, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("handbook_no_adopted_signature");
    expect(rec.writtenRows("handbook_marks")).toHaveLength(0);
  });

  it("refuses without the e-sign consent (§390.32(d))", async () => {
    const result = await recordHandbookMark(seed({ inv: { consented_at: null } }).client, TOKEN, MARK, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("esign_consent_required");
  });

  it("turns the database's refusals into the same sentences", async () => {
    const twice = await recordHandbookMark(seed({ writeError: { code: "23505", message: "dup" } }).client, TOKEN, MARK, CTX, NOW);
    expect(isIntakeError(twice) && twice.code).toBe("handbook_place_already_signed");
    const raced = await recordHandbookMark(seed({ writeError: { code: "HB024", message: "handbook_already_filed" } }).client, TOKEN, MARK, CTX, NOW);
    expect(isIntakeError(raced) && raced.code).toBe("handbook_already_filed");
  });

  it("gives a dead link the answer every other route gives it", async () => {
    const result = await recordHandbookMark(seed({ inv: { revoked_at: "2026-09-25T00:00:00Z" } }).client, TOKEN, MARK, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("invalid_link");
  });
});

describe("reading it", () => {
  it("is a PDF of the carrier's handbook once the office has opened it", async () => {
    const result = await applicantHandbookPdf(seed({ places: ["h1"] }).client, TOKEN, NOW);
    expect(!isIntakeError(result) && result.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(!isIntakeError(result) && result.filename).toBe("driver-handbook.pdf");
  });

  it("leaves the carrier's place blank on the reading copy, even with a countersignature on the ledger", async () => {
    // The countersignature is drawn only on the document that files it (`applicantHandbookPdf`).
    const result = await applicantHandbookPdf(seed({ places: ["h1", "h4c"] }).client, TOKEN, NOW);
    const text = isIntakeError(result) ? "" : await pdfText(result.pdf);
    expect(text).toContain("Jovana Petrović");
    expect(text).not.toContain("Miroslav Jokovic");
  });

  it("is refused before it is opened", async () => {
    const result = await applicantHandbookPdf(seed({ inv: { handbook_signing_opened_at: null } }).client, TOKEN, NOW);
    expect(isIntakeError(result) && result.code).toBe("handbook_not_opened");
  });
});
