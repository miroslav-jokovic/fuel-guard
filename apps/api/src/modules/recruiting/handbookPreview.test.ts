import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { pdfPageTexts, pdfText } from "../../testing/pdfText.js";
import { isHandbookError } from "./handbookSigning.js";
import { handbookPreviewPdf, handbookReadingCopy } from "./handbookPreview.js";

/**
 * The handbook's office preview (APPLICATION-FLOW-V2-PLAN D-AW17, C3s5), and the reading copy it shares
 * with the driver's link. What is pinned: the prefilled name, the SSN only once it exists, the band on
 * the office's copy and never on the driver's, the refusal once filed, and the org filter.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const NAME = "Jovana Petrović-Szczepańska";
const BAND = "DRAFT - NOT A SIGNED HANDBOOK";

const seed = (over: { invitation?: Record<string, unknown> | null; ssnLast4?: string | null } = {}) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: over.invitation === null ? [] : [{
        id: "inv-1", submitted_at: null, signing_opened_at: "2026-09-29T09:00:00Z", handbook_filed_at: null,
        expires_at: "2099-01-01T00:00:00.000Z", ...over.invitation,
      }],
      handbook_marks: [],
      drivers: [{ full_name: NAME }],
      // D-HIRE6: the SSN reaches `driver_applications` at the filing, and not before.
      driver_applications: over.ssnLast4 ? [{ ssn_last4: over.ssnLast4 }] : [],
      organizations: [{ name: "Silvicom Inc", legal_address: null }],
      application_captures: [],
      signature_adoptions: [],
    },
    storage: { download: async () => ({ data: null, error: { message: "none" } }) },
  });

describe("the office's handbook preview (D-AW17)", () => {
  it("prints the applicant's name under a DRAFT band on every page, before the application is filed", async () => {
    const result = await handbookPreviewPdf(seed().client, ORG, DRIVER);
    expect(isHandbookError(result)).toBe(false);
    if (isHandbookError(result)) return;
    expect(result.filename).toContain("preview");
    const pages = await pdfPageTexts(result.pdf);
    expect(pages.join(" ")).toContain(NAME);
    expect(pages.every((p) => p.includes(BAND))).toBe(true);
    // No SSN exists before the filing, so the line is blank rather than a guess.
    expect(pages.join(" ")).not.toContain("•••");
  });

  it("prints the SSN's last four, masked, once the application is filed", async () => {
    const result = await handbookPreviewPdf(seed({ invitation: { submitted_at: "2026-09-29T10:00:00Z" }, ssnLast4: "1234" }).client, ORG, DRIVER);
    if (isHandbookError(result)) throw new Error(result.code);
    expect(await pdfText(result.pdf)).toContain("•••1234");
  });

  it("refuses once the handbook is filed, and for an applicant with no application", async () => {
    const filed = await handbookPreviewPdf(seed({ invitation: { handbook_filed_at: "2026-09-29T12:00:00Z" } }).client, ORG, DRIVER);
    expect(isHandbookError(filed) && filed.code).toBe("already_filed");
    const none = await handbookPreviewPdf(seed({ invitation: null }).client, ORG, DRIVER);
    expect(isHandbookError(none) && none.code).toBe("not_found");
  });

  it("scopes every read to the carrier", async () => {
    const rec = seed();
    await handbookPreviewPdf(rec.client, ORG, DRIVER);
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] });
  });
});

describe("the driver's reading copy", () => {
  it("is the same pages with no band: the page they are about to sign is not called a draft", async () => {
    const pdf = await handbookReadingCopy(seed().client, ORG, DRIVER, "inv-1", null);
    const text = await pdfText(pdf);
    expect(text).toContain(NAME);
    expect(text).not.toContain(BAND);
  });
});
