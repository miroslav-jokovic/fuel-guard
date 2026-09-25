import type { SupabaseClient } from "@supabase/supabase-js";
import { recruitmentTemplateByKey } from "@silvicom/shared";
import { loadCarrierWording } from "./carrierWording.js";
import { carrierOf } from "./applicationPdf/sources.js";
import { permissionInstrumentPdf } from "./applicationPdf/permissionInstrument.js";
import { renderPacketOverlay } from "./applicationPdf/packet/packetOverlay.js";
import { handbookPdf } from "./applicationPdf/handbook/handbookPdf.js";
import { roadTestBlankFormPdf } from "./applicationPdf/roadTest.js";

/**
 * One blank document, for the office to print (MV2, D-MVR2; `recruitmentTemplatesContract.ts`).
 *
 * ── EVERY BRANCH IS THE RENDERER THE ELECTRONIC COPY USES ─────────────────────────────────────
 * A permission is `permissionInstrumentPdf` with no signer — byte-for-byte the document the applicant
 * reads on their link — over the carrier's LIVE wording, so a carrier that has published its own text
 * prints its own text. The application is the carrier's packet with no marks and no answers, which
 * `renderPacketOverlay` already draws with page 4's and page 19's withdrawal notices. The handbook is
 * `handbookPdf` with no name, no marks and no countersignature, which its header says is "the
 * carrier's blank paper". Only the road test needed a blank mode, and it is the same drawing.
 *
 * ⚠ Nothing here reads an applicant, so nothing personal can reach the page; the org is read for the
 * carrier's name and address and its published wording, and both reads are org-scoped.
 */
export async function recruitmentTemplatePdf(
  admin: SupabaseClient,
  orgId: string,
  key: string,
): Promise<{ pdf: Buffer; filename: string } | null> {
  const template = recruitmentTemplateByKey(key);
  if (!template) return null;
  const filename = `${template.key}.pdf`;

  if (template.purpose) {
    const doc = (await loadCarrierWording(admin, orgId)).disclosures[template.purpose];
    const pdf = await permissionInstrumentPdf({
      purpose: template.purpose,
      version: doc.version,
      title: doc.title,
      body: doc.body,
      intent: doc.intent,
      carrier: await carrierOf(admin, orgId),
      signer: null,
    });
    return { pdf, filename };
  }

  switch (template.key) {
    case "application-packet":
      return { pdf: await renderPacketOverlay({ marks: [] }), filename };
    case "handbook": {
      const carrier = await carrierOf(admin, orgId);
      const pdf = await handbookPdf({
        carrier: { name: carrier.name },
        driverName: "",
        ssnLast4: null,
        marks: new Map(),
        driverSignature: null,
        countersign: null,
      });
      return { pdf, filename };
    }
    case "road-test":
      return { pdf: await roadTestBlankFormPdf(await carrierOf(admin, orgId)), filename };
    default:
      // A key in the catalogue with no drawing here is a defect, and a 404 is the honest answer to it;
      // "draws every catalogued template as a PDF" (`routes/templates.test.ts`) renders every key, so
      // it cannot ship.
      return null;
  }
}
