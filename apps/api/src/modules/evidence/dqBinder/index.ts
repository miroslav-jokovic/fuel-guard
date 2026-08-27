import type { SupabaseClient } from "@supabase/supabase-js";
import { DOCUMENTS_BUCKET } from "@silvicom/shared";
import type { PDFDocument } from "pdf-lib";
import {
  gatherCarrier,
  gatherSample,
  hazmatEnabled,
  type BinderDocumentRef,
  type DriverBinderData,
} from "./gather.js";
import {
  appendImage,
  appendPdf,
  createBinderDocument,
  finalize,
  stampFooters,
  MAX_SOURCE_BYTES,
} from "./merge.js";
import {
  renderDriverBack,
  renderDriverFront,
  renderMasterCover,
  renderSeparator,
  renderStampedDocument,
  renderUnreadable,
  type BinderContext,
} from "./render.js";

/**
 * The audit binder (DQ-BINDER-PLAN). An auditor names a sample of drivers; this produces their
 * §391.51 files as ONE PDF, in the order they asked for them, ready to print or attach.
 *
 * THE ORDER OF OPERATIONS IS THE POLICY. Draw the front matter, then for each requirement that has a
 * scan: a separator page saying what the scan proves, then the scan itself. A scan that cannot be
 * read becomes a page that SAYS it cannot be read (D-BD5) — never a silent gap, because the auditor
 * finds the gap anyway and then distrusts everything around it.
 */

export interface BinderResult {
  bytes: Buffer;
  pages: number;
  driversCount: number;
  documentsCount: number;
  /** Requirements expired or never recorded across the sample — the number printed on each cover. */
  gapsCount: number;
  missingIds: string[];
}

export class BinderError extends Error {}

/** A drawn or copied fragment plus the driver its pages belong to, for the footer stamp. */
async function appendDrawn(
  out: PDFDocument,
  labels: string[],
  label: string,
  bytes: Buffer,
): Promise<void> {
  const added = await appendPdf(out, bytes);
  for (let i = 0; i < added; i++) labels.push(label);
}

async function download(admin: SupabaseClient, ref: BinderDocumentRef): Promise<Buffer> {
  const { data, error } = await admin.storage.from(DOCUMENTS_BUCKET).download(ref.storagePath);
  if (error || !data) throw new BinderError(error?.message ?? "the scan is not in storage");
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Copy one filed scan in behind its separator. Returns whether the scan's own pages made it.
 *
 * Every failure mode here — a deleted object, an encrypted PDF, an image format sharp cannot decode —
 * ends the same way: a page naming the document, its digest and the reason. The binder stays
 * complete as a DOCUMENT even when the record store has a hole in it, and the hole is legible.
 */
async function appendScan(
  admin: SupabaseClient,
  out: PDFDocument,
  labels: string[],
  data: DriverBinderData,
  label: string,
  ref: BinderDocumentRef,
  budget: { spent: number },
): Promise<boolean> {
  try {
    const bytes = await download(admin, ref);
    budget.spent += bytes.byteLength;
    if (budget.spent > MAX_SOURCE_BYTES) {
      throw new BinderError(
        `This sample is larger than one file can hold (${Math.round(budget.spent / 1e6)} MB of scans so far). Request it in two smaller samples.`,
      );
    }
    const added =
      ref.contentType === "application/pdf"
        ? await appendPdf(out, bytes)
        : await appendImage(out, bytes, ref.contentType);
    for (let i = 0; i < added; i++) labels.push(data.driver.name);
    return true;
  } catch (e) {
    if (e instanceof BinderError && e.message.startsWith("This sample is larger")) throw e;
    const reason = e instanceof Error ? e.message : "unknown error";
    await appendDrawn(
      out,
      labels,
      data.driver.name,
      await renderUnreadable(data, label, ref, reason),
    );
    return false;
  }
}

export interface BinderRequestContext {
  exportId: string;
  asAt: string;
  generatedAt: string;
  generatedBy: string;
  /** Phase G (D-DQ15): from the export ledger row, where the route recorded the privileged ask.
   *  Absent/false = the default binder, with no §382.401/§391.53 evidence in it. */
  includeRestricted?: boolean;
}

export async function buildBinder(
  admin: SupabaseClient,
  orgId: string,
  driverIds: string[],
  req: BinderRequestContext,
  report?: (done: number, total: number) => Promise<void>,
): Promise<BinderResult> {
  const [carrier, includeHazmat] = await Promise.all([
    gatherCarrier(admin, orgId),
    hazmatEnabled(admin, orgId),
  ]);
  const { drivers, missingIds } = await gatherSample(
    admin,
    orgId,
    driverIds,
    req.asAt,
    includeHazmat,
    req.includeRestricted === true,
  );
  if (drivers.length === 0) {
    throw new BinderError("None of the drivers requested are on this carrier's roster.");
  }

  const ctx: BinderContext = { carrier, ...req };
  const out = await createBinderDocument({
    title: `Driver qualification files — ${carrier.name}`,
    carrierName: carrier.name,
    exportId: req.exportId,
    generatedAt: req.generatedAt,
  });

  const labels: string[] = [];
  const budget = { spent: 0 };
  let documentsCount = 0;
  let gapsCount = 0;

  await appendDrawn(out, labels, carrier.name, await renderMasterCover(drivers, ctx, missingIds));

  for (let i = 0; i < drivers.length; i++) {
    const data = drivers[i]!;
    const name = data.driver.name;
    gapsCount += data.file.counts.expired + data.file.counts.missing;

    await appendDrawn(out, labels, name, await renderDriverFront(data, ctx));

    for (const item of data.file.items) {
      if (!item.documentId) continue;
      const ref = data.documentsById.get(item.documentId);
      if (!ref) continue; // buildDqFile already discards ids with no row; belt and braces
      await appendDrawn(
        out,
        labels,
        name,
        await renderSeparator(data, item.spec.label, item.spec.citation, ref, item.goodUntil, ctx),
      );
      if (await appendScan(admin, out, labels, data, item.spec.label, ref, budget))
        documentsCount++;
    }

    await appendDrawn(out, labels, name, await renderDriverBack(data));
    await report?.(i + 1, drivers.length);
  }

  await stampFooters(out, labels, { exportId: req.exportId, generatedAt: req.generatedAt });
  const bytes = await finalize(out);

  return {
    bytes,
    pages: out.getPageCount(),
    driversCount: drivers.length,
    documentsCount,
    gapsCount,
    missingIds,
  };
}

/**
 * One requirement, on its own, stamped (D-BD10).
 *
 * This is the OUTWARD case — a broker or shipper asking for a driver's credentials before releasing
 * a load. Internal sharing is answered by access, not by attachment: dispatch can already open the
 * qualification file. The stamp is what makes this safe to send: driver, requirement, validity, who
 * exported it and when, so a page that turns up in somebody's inbox six months later can be traced
 * and its expiry read off the page rather than assumed.
 */
export async function buildDocumentExport(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  requirementKey: string,
  req: BinderRequestContext,
): Promise<{ bytes: Buffer; pages: number; documentId: string }> {
  const [carrier, includeHazmat] = await Promise.all([
    gatherCarrier(admin, orgId),
    hazmatEnabled(admin, orgId),
  ]);
  // includeRestricted true: the ROUTE has already refused a non-privileged caller asking for a
  // restricted requirement, and a privileged release of one is exactly what this export is.
  const { drivers } = await gatherSample(admin, orgId, [driverId], req.asAt, includeHazmat, true);
  const data = drivers[0];
  if (!data) throw new BinderError("That driver is not on this carrier's roster.");

  const item = data.file.items.find((x) => x.spec.key === requirementKey);
  if (!item) throw new BinderError("That is not a driver qualification requirement.");
  const ref = item.documentId ? data.documentsById.get(item.documentId) : undefined;
  if (!ref) {
    throw new BinderError(
      `No scan is on file for ${item.spec.label.toLowerCase()}. Upload one from the driver's qualification file first.`,
    );
  }

  const ctx: BinderContext = { carrier, ...req };
  const out = await createBinderDocument({
    title: `${item.spec.label} — ${data.driver.name}`,
    carrierName: carrier.name,
    exportId: req.exportId,
    generatedAt: req.generatedAt,
  });

  const labels: string[] = [];
  await appendDrawn(
    out,
    labels,
    data.driver.name,
    await renderStampedDocument(data, item, ref, ctx),
  );
  const bytes = await download(admin, ref);
  const added =
    ref.contentType === "application/pdf"
      ? await appendPdf(out, bytes)
      : await appendImage(out, bytes, ref.contentType);
  for (let i = 0; i < added; i++) labels.push(data.driver.name);

  await stampFooters(out, labels, { exportId: req.exportId, generatedAt: req.generatedAt });
  return { bytes: await finalize(out), pages: out.getPageCount(), documentId: ref.id };
}
