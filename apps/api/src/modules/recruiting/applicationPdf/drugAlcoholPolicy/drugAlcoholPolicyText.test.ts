import { describe, expect, it } from "vitest";
import { correctHandbook } from "../handbook/handbookText.js";
import { flowedDocumentPdf } from "../handbook/handbookPdf.js";
import { DRUG_ALCOHOL_POLICY_CORRECTIONS } from "./drugAlcoholPolicyCorrections.js";
import {
  DRUG_ALCOHOL_POLICY_BLOCKS,
  DRUG_ALCOHOL_POLICY_DOCUMENT,
  DRUG_ALCOHOL_POLICY_SOURCE_BLOCKS,
  DRUG_ALCOHOL_POLICY_VERSION,
} from "./drugAlcoholPolicyText.js";

/** HIRING-WORKFLOW-AUDIT-2026-10-31 §15.2 — the carrier's §382.601 policy as a document of ours. */
const words = (blocks: typeof DRUG_ALCOHOL_POLICY_BLOCKS): string =>
  blocks
    .flatMap((b) => (b.k === "p" || b.k === "item" ? b.runs.map((r) => r.t) : b.k === "grid" ? b.rows.flat() : []))
    .join("\n");

describe("the drug and alcohol abuse policy (§15.2)", () => {
  it("prints every one of its ten sections, in order", () => {
    const headings = DRUG_ALCOHOL_POLICY_BLOCKS.filter((b) => b.k === "p" && b.heading).map((b) => (b.k === "p" ? b.runs[0]!.t : ""));
    const sections = headings.filter((h) => h.startsWith("SECTION")).map((h) => Number(/SECTION (\d+)/.exec(h)![1]));
    expect(sections).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("names the person who answers drivers' questions and the consortium — §382.601(b)(1)", () => {
    const text = words(DRUG_ALCOHOL_POLICY_BLOCKS);
    expect(text).toContain("Designated Employer Representative: Marija Varmeda");
    // Q-DAP3 (owner, 2026-11-04): the scan's "Vermeda" is a misspelling and never prints.
    expect(text).not.toContain("Vermeda");
    expect(text).toContain("Phone: (708) 236-5732 (Safety)");
    expect(text).toContain("The company's consortium is Med-Stop, Elk Grove Village, IL.");
  });

  it("prints the owner's corrections and none of the errors they replace (D-DAP6)", () => {
    const printed = words(DRUG_ALCOHOL_POLICY_BLOCKS);
    for (const c of DRUG_ALCOHOL_POLICY_CORRECTIONS) {
      // An error that is a prefix of its own correction ("Follow – Up" never is) cannot be checked by absence.
      if (c.right.includes(c.wrong)) continue;
      expect(printed, c.wrong).not.toContain(c.wrong);
    }
    for (const fixed of ["Refusal to submit", "the BAT shall sign", "EMPLOYEE ASSISTANCE PROGRAM", "persons designated by", "contact SILVICOM INC at:"]) {
      expect(printed).toContain(fixed);
    }
  });

  it("keeps the transcription itself faithful to the scan, typos included", () => {
    const source = words(DRUG_ALCOHOL_POLICY_SOURCE_BLOCKS);
    expect(source).toContain("Refusal to summit");
    expect(source).toContain("EMPLOYEE ADMISSION PROGRAM");
  });

  it("refuses at import a correction that lands a different number of times than it declares", () => {
    expect(() => correctHandbook(DRUG_ALCOHOL_POLICY_SOURCE_BLOCKS, [{ wrong: "Refusal to summit", right: "x", times: 2 }])).toThrow(
      /does not fit the text/,
    );
  });

  it("is versioned by a hash of what prints, so a receipt names its text", () => {
    expect(DRUG_ALCOHOL_POLICY_VERSION).toMatch(/^dap-[0-9a-f]{16}$/);
    expect(DRUG_ALCOHOL_POLICY_DOCUMENT.version).toBe(DRUG_ALCOHOL_POLICY_VERSION);
  });

  it("ends on the driver's own signature place, the page-28 receipt", () => {
    const last = DRUG_ALCOHOL_POLICY_BLOCKS.at(-1);
    expect(last).toMatchObject({ k: "sign", id: "p28" });
  });

  it("draws as a PDF in the handbook's layout, with the receipt on its signature line", async () => {
    const pdf = await flowedDocumentPdf(DRUG_ALCOHOL_POLICY_DOCUMENT, {
      carrier: { name: "SILVICOM INC" }, driverName: "Dana Driver", ssnLast4: null,
      marks: new Map([["p28", { signedName: "Dana Driver", signedAt: "2026-11-04T16:00:00Z" }]]),
      driverSignature: null, countersign: null,
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(20_000);
  });
});
