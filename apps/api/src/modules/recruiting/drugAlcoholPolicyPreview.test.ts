import { describe, expect, it } from "vitest";
import { createSupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { pdfPageTexts, pdfText } from "../../testing/pdfText.js";
import { drugAlcoholPolicyPdf } from "./applicationPdf/drugAlcoholPolicy/drugAlcoholPolicyCopy.js";
import { DRUG_ALCOHOL_POLICY_VERSION } from "./applicationPdf/drugAlcoholPolicy/drugAlcoholPolicyText.js";
import {
  DRUG_ALCOHOL_POLICY_PREVIEW_BAND,
  drugAlcoholPolicyInfo,
  drugAlcoholPolicyPreviewPdf,
} from "./drugAlcoholPolicyPreview.js";

/**
 * The office's blank policy preview (§15.2 DAP2, Settings → Recruiting). What is pinned: the DRAFT band on
 * every page and on no copy a driver is given; the carrier's own name and the text version in use on the
 * footer; a blank signature line, with no receipt or signature picture read; and that it is the very pages
 * the applicant's link draws — the one-drawing rule, checked page by page.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const seed = () =>
  createSupabaseRecorder({
    tables: {
      organizations: [{ name: "Silvicom Inc", legal_address: null }],
      application_packet_marks: [],
      signature_adoptions: [],
      application_captures: [],
      application_packet_mark_adoptions: [],
    },
  });

describe("the office's blank drug-and-alcohol policy", () => {
  it("prints the DRAFT band, the carrier and the text version on every page", async () => {
    const { pdf, filename } = await drugAlcoholPolicyPreviewPdf(seed().client, ORG);
    const pages = await pdfPageTexts(pdf);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      expect(page).toContain(DRUG_ALCOHOL_POLICY_PREVIEW_BAND);
      expect(page).toContain(`text ${DRUG_ALCOHOL_POLICY_VERSION}`);
      expect(page).toContain("Silvicom Inc");
    }
    expect(filename).toBe(`drug-alcohol-policy-${DRUG_ALCOHOL_POLICY_VERSION}-preview.pdf`);
  });

  it("reads only the carrier's own name — no receipt, no signature picture", async () => {
    const rec = seed();
    await drugAlcoholPolicyPreviewPdf(rec.client, ORG);
    const tables = [...new Set(rec.queries.map((q) => q.table))];
    expect(tables).toEqual(["organizations"]);
    expect(rec.forTable("organizations")[0]!.filters()).toEqual(expect.arrayContaining([{ col: "id", val: ORG }]));
    expect(rec.storageCalls()).toEqual([]);
  });

  it("is the applicant's pages exactly, with the band the only difference", async () => {
    const { pdf } = await drugAlcoholPolicyPreviewPdf(seed().client, ORG);
    const office = await pdfPageTexts(pdf);
    const given = await pdfPageTexts(await drugAlcoholPolicyPdf(seed().client, ORG, "inv-1", null));
    expect(office.length).toBe(given.length);
    office.forEach((page, i) => {
      expect(page.replace(DRUG_ALCOHOL_POLICY_PREVIEW_BAND, "").replace(/\s+/g, " ").trim())
        .toBe(given[i]!.replace(/\s+/g, " ").trim());
    });
    // And the driver's copy is never called a draft.
    expect(await pdfText(await drugAlcoholPolicyPdf(seed().client, ORG, "inv-1", null))).not.toContain("DRAFT");
  });

  it("leaves the signature line blank even when handed a receipt, because it names no link", async () => {
    const signed = await pdfText(await drugAlcoholPolicyPdf(seed().client, ORG, null, {
      signedName: "Susan Godfrey", signedAt: "2026-11-04T16:00:00Z", policyVersion: DRUG_ALCOHOL_POLICY_VERSION,
    }));
    expect(signed).not.toContain("Susan Godfrey");
    expect(signed).toContain("DRIVER SIGNATURE");
  });

  it("names the text in use for the Settings card from the text itself", () => {
    expect(drugAlcoholPolicyInfo()).toEqual({ name: "Drug and alcohol abuse policy", version: DRUG_ALCOHOL_POLICY_VERSION });
    expect(DRUG_ALCOHOL_POLICY_VERSION).toMatch(/^dap-[0-9a-f]{16}$/);
  });
});
