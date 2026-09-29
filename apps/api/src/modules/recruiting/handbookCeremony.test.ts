import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { postgrestFixture, type FixtureRow } from "../../testing/postgrestFixture.js";
import { hashInvitationToken, isIntakeError } from "./applicationIntake.js";
import { applicantHandbookPdf, linkHandbookStatus, recordHandbookMark } from "./handbookCeremony.js";
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
  submitted_at: "2026-09-25T10:00:00Z", signing_opened_at: "2026-09-25T09:00:00Z", handbook_filed_at: null,
  ...over,
});

const seed = (over: { inv?: Record<string, unknown>; adopted?: string | null; writeError?: unknown; places?: string[];
  packetMarks?: Array<Record<string, unknown>>; handbookName?: string;
  /** Screen 13's adoptions on this link (D-AW15), and the one the places already signed carry. */
  adoptions?: FixtureRow[]; placeAdoption?: string | null;
} = {}) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: [invitation(over.inv)],
      org_disclosures: [],
      // The packet's adopted signature: one `signature` mark is enough for `adoptedPacketMarks`.
      application_packet_marks: over.packetMarks ?? (over.adopted === null ? [] : [{ mark: "signature", signed_name: over.adopted ?? "Jovana Petrović" }]),
      handbook_marks: (q: RecordedQuery) =>
        q.write
          ? (over.writeError ? { writeError: over.writeError } : [])
          : (over.places ?? []).map((placement_id) => ({
              placement_id,
              signed_name: placement_id === "h4c" ? "Miroslav Jokovic" : (over.handbookName ?? "Jovana Petrović"),
              party: placement_id === "h4c" ? "carrier" : "driver",
              signed_at: "2026-09-25T11:05:00Z",
              representative_id: null,
              adoption_id: placement_id === "h4c" ? null : (over.placeAdoption ?? null),
            })),
      signature_adoptions: postgrestFixture(over.adoptions ?? []),
      drivers: [{ full_name: "Jovana Petrović-Szczepańska" }],
      driver_applications: [{ ssn_last4: "1234" }],
      organizations: [{ name: "Silvicom Inc", legal_address: null }],
      application_captures: [],
      qualification_records: [],
      documents: [],
    },
    storage: { download: async () => ({ data: null, error: { message: "none" } }) },
  });

const MARK = { placement_id: "h3" as const, esign_consent: true as const, handbook_version: HANDBOOK_VERSION };

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

  it("refuses on an application never sent for signing (HB023's twin), and says who sends it", async () => {
    const result = await recordHandbookMark(seed({ inv: { signing_opened_at: null } }).client, TOKEN, MARK, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("handbook_not_opened");
    expect(isIntakeError(result) && result.message).toMatch(/has not sent your application/);
  });

  it("is open on the envelope alone: no second opening at the desk (D-AW16, C3s4b)", async () => {
    const rec = seed({ inv: { signing_opened_at: "2026-09-25T09:00:00Z", handbook_signing_opened_at: null } });
    const result = await recordHandbookMark(rec.client, TOKEN, MARK, CTX, NOW);
    expect(isIntakeError(result)).toBe(false);
    expect(rec.writtenRows("handbook_marks")).toHaveLength(1);
  });

  it("refuses once it is filed", async () => {
    const result = await recordHandbookMark(seed({ inv: { handbook_filed_at: "2026-09-25T12:00:00Z" } }).client, TOKEN, MARK, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("handbook_already_filed");
  });

  it("refuses when the packet holds marks but no adopted signature, rather than inventing one", async () => {
    const rec = seed({ packetMarks: [{ mark: "initials", signed_name: "JP" }] });
    const result = await recordHandbookMark(rec.client, TOKEN, MARK, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("handbook_no_adopted_signature");
    expect(rec.writtenRows("handbook_marks")).toHaveLength(0);
  });

  // A page loaded before C3s2a may still send C0b's `signed_name`; the schema strips it, and so does this.
  it("signs with the packet's adopted name even when a name is typed here", async () => {
    const rec = seed({ places: ["h3"] });
    await recordHandbookMark(rec.client, TOKEN, { ...MARK, signed_name: "Somebody Else" } as never, CTX, NOW);
    expect(rec.writtenRows("handbook_marks")[0]).toMatchObject({ signed_name: "Jovana Petrović" });
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

  it("refuses a place read under a different handbook text, and writes nothing (A-6)", async () => {
    const rec = seed();
    const result = await recordHandbookMark(rec.client, TOKEN, { ...MARK, handbook_version: "handbook-older" }, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("handbook_changed");
    expect(rec.writtenRows("handbook_marks")).toHaveLength(0);
  });

  it("tells the page which text it is showing (A-6)", async () => {
    const view = await linkHandbookStatus(seed().client, invitation({ org_id: ORG }));
    expect(view?.version).toBe(HANDBOOK_VERSION);
  });

  it("gives a dead link the answer every other route gives it", async () => {
    const result = await recordHandbookMark(seed({ inv: { revoked_at: "2026-09-25T00:00:00Z" } }).client, TOKEN, MARK, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("invalid_link");
  });
});

/**
 * D-AW15 (C3s2a): the handbook is signed with the link's adoption, which replaced C0b's self-adoption.
 * The fixture carries ANOTHER org's live adoption on the same invitation id, so a read that forgot its
 * org filter would sign this driver's handbook with a stranger's name.
 */
describe("signing with the adopted signature", () => {
  const adoption = (org: string, id: string, typed: string): FixtureRow => ({
    id, org_id: org, invitation_id: "inv-1", kind: "signature", typed_text: typed, superseded_by: null,
  });
  const STRANGER = adoption("0f0f0f0f-4e5f-4a6b-8c7d-9e0f1a2b3c4d", "theirs", "Somebody Else");

  it("signs with the adoption's text and records which adoption it applied, over the packet's name", async () => {
    const rec = seed({ adopted: "Packet Name", adoptions: [adoption(ORG, "a1", "Jovana P."), STRANGER] });
    const result = await recordHandbookMark(rec.client, TOKEN, MARK, CTX, NOW);
    expect(isIntakeError(result)).toBe(false);
    expect(rec.writtenRows("handbook_marks")[0]).toMatchObject({ signed_name: "Jovana P.", adoption_id: "a1" });
    expectOrgScoped(rec, ORG, { exempt: ["application_invitations", "organizations"] });
  });

  it("refuses a place when the earlier places were signed with another adoption, and writes nothing", async () => {
    const rec = seed({ places: ["h1"], placeAdoption: "a0", adoptions: [adoption(ORG, "a1", "Jovana P.")] });
    const result = await recordHandbookMark(rec.client, TOKEN, MARK, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("adoption_changed_mid_document");
    expect(rec.writtenRows("handbook_marks")).toHaveLength(0);
  });

  it("signs with the packet's name and no adoption when the link's adoption never saved (A8b)", async () => {
    const rec = seed({ adoptions: [STRANGER] });
    await recordHandbookMark(rec.client, TOKEN, MARK, CTX, NOW);
    expect(rec.writtenRows("handbook_marks")[0]).toMatchObject({ signed_name: "Jovana Petrović", adoption_id: null });
  });

  it("tells the link nothing about adopting: the handbook no longer adopts its own", async () => {
    const view = await linkHandbookStatus(seed().client, invitation({ org_id: ORG }));
    expect(view).not.toHaveProperty("adoption");
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
    const result = await applicantHandbookPdf(seed({ inv: { signing_opened_at: null } }).client, TOKEN, NOW);
    expect(isIntakeError(result) && result.code).toBe("handbook_not_opened");
  });
});
