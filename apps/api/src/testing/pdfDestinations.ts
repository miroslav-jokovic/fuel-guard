import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, PDFString, PDFHexString, type PDFObject } from "pdf-lib";

/**
 * Every named destination in a PDF, as the signing walk's pdfjs would resolve it (D-HB12).
 *
 * Reads BOTH forms a document can carry: the catalog's `/Dests` dictionary (what
 * `packetPlaceDestinations.ts` writes with pdf-lib) and the `/Names /Dests` name tree, flat or with
 * `/Kids` (what pdfkit's `addNamedDestination` writes). pdfjs's `getDestination` reads both, so a
 * test that read only one could pass on a document the walk cannot use.
 */
export interface PdfDestination {
  /** 1-based page the destination points at. */
  page: number;
  kind: string;
  /** The numbers after the kind — `FitR`'s left, bottom, right, top. */
  args: number[];
}

export async function pdfDestinations(bytes: Uint8Array): Promise<Map<string, PdfDestination>> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pageIndex = new Map(doc.getPages().map((p, i) => [p.ref.toString(), i + 1]));
  const lookup = (o: PDFObject | undefined): PDFObject | undefined => (o instanceof PDFRef ? doc.context.lookup(o) : o);
  const out = new Map<string, PdfDestination>();

  const add = (name: string, value: PDFObject | undefined): void => {
    let v = lookup(value);
    if (v instanceof PDFDict) v = lookup(v.get(PDFName.of("D")));
    if (!(v instanceof PDFArray)) return;
    const [ref, kind, ...rest] = v.asArray();
    const page = ref instanceof PDFRef ? pageIndex.get(ref.toString()) : undefined;
    if (!page || !(kind instanceof PDFName)) return;
    out.set(name, {
      page,
      kind: kind.decodeText(),
      args: rest.map((n) => (n instanceof PDFNumber ? n.asNumber() : NaN)),
    });
  };
  const text = (o: PDFObject | undefined): string | null =>
    o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : null;

  const dests = lookup(doc.catalog.get(PDFName.of("Dests")));
  if (dests instanceof PDFDict) {
    for (const [k, v] of dests.entries()) add(k.decodeText(), v);
  }

  const walk = (node: PDFObject | undefined): void => {
    const n = lookup(node);
    if (!(n instanceof PDFDict)) return;
    const names = lookup(n.get(PDFName.of("Names")));
    if (names instanceof PDFArray) {
      const items = names.asArray();
      for (let i = 0; i + 1 < items.length; i += 2) {
        const key = text(lookup(items[i]));
        if (key) add(key, items[i + 1]);
      }
    }
    const kids = lookup(n.get(PDFName.of("Kids")));
    if (kids instanceof PDFArray) for (const k of kids.asArray()) walk(k);
  };
  const namesRoot = lookup(doc.catalog.get(PDFName.of("Names")));
  if (namesRoot instanceof PDFDict) walk(namesRoot.get(PDFName.of("Dests")));
  return out;
}
