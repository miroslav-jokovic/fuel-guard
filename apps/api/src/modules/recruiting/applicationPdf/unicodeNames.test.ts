import { describe, it, expect } from "vitest";
import type { DriverApplication } from "@silvicom/shared";
import { pdfText } from "../../../testing/pdfText.js";
import { renderPacketDocument } from "./packetDocument.js";
import { renderApplicationPdf } from "./render.js";
import { appendContinuationSheet } from "./packet/packetContinuation.js";
import { PDFDocument } from "pdf-lib";

/**
 * Q-AF2, end to end: the names that broke the filing now file, spelled as typed.
 *
 * ⚠ Measured before the fix (2026-09-25): `renderPacketDocument` THREW `WinAnsi cannot encode "ć"`
 * for all four of the first names below, so an application filed with no packet PDF behind it and
 * the applicant's copy never became available; and the §391.21 summary printed `Petrovic`. José
 * Muñoz rendered, because `é ñ` are WinAnsi — he is here so a fix for one alphabet cannot cost
 * another.
 */
const PEOPLE = [
  ["Marko", "Petrović"], ["Đorđe", "Jokić"], ["Miloš", "Živković"], ["Anna", "Szczepańska"], ["José", "Muñoz"],
] as const;

describe("a name outside Windows-1252, on the filed documents", () => {
  for (const [first, last] of PEOPLE) {
    const name = `${first} ${last}`;

    it(`files ${name}'s signed packet, with the name as typed`, async () => {
      const pdf = await renderPacketDocument({
        marks: [{ placement_id: "p31a", signed_name: name, signed_at: "2026-09-17T15:00:00Z" }],
        application: { first_name: first, last_name: last, questionnaire_answers: {} } as unknown as DriverApplication,
        certifiedAt: "",
        signedName: name,
      });
      expect(await pdfText(pdf)).toContain(name);
    });

    it(`prints ${name} as typed on the §391.21 summary`, async () => {
      const pdf = await renderApplicationPdf({
        carrier: { name: "Silvicom Inc", address: null },
        application: { first_name: first, last_name: last } as unknown as DriverApplication,
        applicationId: "11111111-2222-4333-8444-555555555555",
        certifiedAt: "2026-09-17T15:00:00Z",
        signedName: name,
        applicantIp: "203.0.113.9",
        applicantUserAgent: "test",
        signatureMark: null,
        preview: null,
        authorizations: [{
          purpose: "fcra_disclosure", disclosure_version: "v1", disclosure_text: "Text.",
          intent_statement: "I authorize.", signed_name: name, accepted_at: "2026-09-17T14:50:00Z",
          method: "esign", accepted_ip: "203.0.113.9", accepted_user_agent: "test",
        }],
      } as unknown as Parameters<typeof renderApplicationPdf>[0]);
      const text = await pdfText(pdf);
      expect(text).toContain(last);
      // The fold it replaced would have printed the letters without their marks.
      if (last !== last.normalize("NFD").replace(/[̀-ͯ]/g, "")) {
        expect(text).not.toContain(last.normalize("NFD").replace(/[̀-ͯ]/g, ""));
      }
    });
  }
});

/**
 * ⚠ A character NO face can draw must be folded on EVERY path that draws applicant text, not merely
 * somewhere. The name reaches the packet three ways — the placed fields (`packetFit`), the typed mark
 * (`packetOverlay`) and the continuation sheet — and a test asking only "is the name on the page"
 * passed with any one of them drawing raw: measured by mutation 2026-09-25, all three survived.
 * pdf-lib does not refuse a glyph the face lacks, it draws an empty box, so the only visible sign is
 * the character itself turning up in the read-back.
 */
describe("a character no face can draw", () => {
  const RAW = "Li 漢";
  const packetText = async (last: string) =>
    pdfText(await renderPacketDocument({
      marks: [{ placement_id: "p31a", signed_name: `Li ${last}`, signed_at: "2026-09-17T15:00:00Z" }],
      application: { first_name: "Li", last_name: last, questionnaire_answers: {} } as unknown as DriverApplication,
      certifiedAt: "",
      signedName: `Li ${last}`,
    }));
  const count = (text: string, needle: string): number => text.split(needle).length - 1;

  /**
   * ⚠ Counted against the SAME packet with a plain name, not against a number written here. pdf-lib's
   * `ToUnicode` omits a glyph the face lacks, so a path that drew `漢` raw reads back as `Li ` — not
   * as `漢`, which is why `not.toContain("漢")` alone could not see it. Every place the plain name is
   * drawn must carry the folded one, so any path that skips the fold lowers the count.
   */
  it("is folded wherever the packet draws the name — fields and the typed mark alike", async () => {
    const plain = count(await packetText("X"), "Li X");
    expect(plain, "the plain name is drawn more than once").toBeGreaterThan(1);
    const text = await packetText("漢");
    expect(count(text, "Li ?")).toBe(plain);
    expect(text).not.toContain("漢");
  });

  it("is folded on the continuation sheet, in the heading and in a row", async () => {
    const doc = await PDFDocument.load(await (await import("node:fs/promises")).readFile(
      (await import("./packet/packetTemplate.js")).PACKET_TEMPLATE_PATH,
    ));
    await appendContinuationSheet(doc, {
      applicantName: RAW,
      overflow: [{ tableId: "p12-employers", label: "Employers", columns: ["Name"], page: 12, rows: [["漢 Freight"]] }],
    });
    const text = await pdfText(Buffer.from(await doc.save()));
    expect(text).toContain("? Freight");
    expect(text).toContain("application of Li ?");
    expect(text).not.toContain("漢");
  });
});
