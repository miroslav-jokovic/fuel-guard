import type { SupabaseClient } from "@supabase/supabase-js";
import { DOCUMENT_CONTENT_TYPES, type DocumentContentType } from "@silvicom/shared";
import type { Env } from "../../../env.js";
import { derivedUuid } from "../../../lib/derivedUuid.js";
import { fileGeneratedDocument } from "../../evidence/index.js";
import { downloadInvoiceFiles, type DownloadedInvoiceFile } from "../../fleetpal/index.js";

/**
 * The vendor's paper, frozen with a roadside repair's certification (FLEETPAL-INTEGRATION-PLAN Q12 (a), ruled
 * by the owner 2026-11-18; F16c; 49 CFR 396.9(d)).
 *
 * ── WHY HERE AND NOWHERE ELSE ──────────────────────────────────────────────────────────────────────
 * Every screen reads a work order's scanned bills from FleetPal live (D-FP28): its links expire in an hour,
 * and a standing copy would be a second archive with no backup. A certification is the one moment the paper
 * must stop moving — "corrected, and this is the bill" — so each file on the accepted work orders' invoices
 * is filed on the inspection as `roadside_repair_bill` (0631), in `documents`, an append-only evidence table.
 *
 * ── ALL OR NOTHING, AND BEFORE THE RECORD ──────────────────────────────────────────────────────────
 * The bills are filed BEFORE the rendered record, which then names each one with its SHA-256 — so the signed
 * PDF points at the exact bytes kept. If FleetPal cannot hand over every file the certification is refused
 * and can be retried; certifying with a bill silently missing would sign for paper we do not hold. Each
 * document id is derived from the certification and the file, so a retried click lands on the same rows.
 *
 * ── A FILE WE CANNOT KEEP IS SAID, NOT DROPPED ─────────────────────────────────────────────────────
 * `documents` admits PDFs and images only. FleetPal's own type is guessed from the file name, so the bytes
 * decide; anything else is listed on the record as not kept, with its name, rather than vanishing.
 */

export interface FrozenBill {
  invoiceId: string;
  filename: string;
  /** Null when the file is not a type `documents` keeps — the record says so. */
  documentId: string | null;
  sha256: string | null;
}

export type FreezeOutcome =
  | { ok: true; bills: FrozenBill[] }
  | { ok: false; code: "fleetpal_not_connected" | "fleetpal_unreachable" | "bill_too_large" | "storage_failed"; message: string };

/** What the bytes are, from their first bytes — FleetPal's `content_type` is a guess from the name. */
export function sniffContentType(bytes: Buffer): DocumentContentType | null {
  const at = (sig: number[], off = 0) => sig.every((b, i) => bytes[off + i] === b);
  if (at([0x25, 0x50, 0x44, 0x46])) return "application/pdf";
  if (at([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (at([0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (at([0x52, 0x49, 0x46, 0x46]) && at([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (at([0x66, 0x74, 0x79, 0x70], 4) && /^(heic|heix|mif1)$/.test(bytes.subarray(8, 12).toString("latin1"))) return "image/heic";
  return null;
}

const KEPT = new Set<string>(DOCUMENT_CONTENT_TYPES);

export async function freezeBills(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  input: { certificationId: string; inspectionId: string; actorId: string; signedOn: string; invoiceIds: readonly string[] },
  fetchImpl?: typeof fetch,
): Promise<FreezeOutcome> {
  const got = await downloadInvoiceFiles(admin, env, orgId, input.invoiceIds, fetchImpl);
  if (got.state !== "read") {
    const refusal = {
      not_connected: { code: "fleetpal_not_connected", message: "FleetPal is not connected, so the vendor bills cannot be filed with this certification. An admin connects it under Settings → FleetPal." },
      unreachable: { code: "fleetpal_unreachable", message: "FleetPal did not hand over the vendor bills just now, so nothing was certified. Try again in a minute." },
      too_large: { code: "bill_too_large", message: "A vendor bill on this work order is too large to file. Nothing was certified." },
    } as const;
    return { ok: false, ...refusal[got.state] };
  }
  const bills: FrozenBill[] = [];
  for (const f of got.files) {
    const bill = await fileOne(admin, orgId, input, f);
    if (!bill) return { ok: false, code: "storage_failed", message: "Could not store a vendor bill. Nothing was certified; try again." };
    bills.push(bill);
  }
  return { ok: true, bills };
}

async function fileOne(
  admin: SupabaseClient,
  orgId: string,
  input: { certificationId: string; inspectionId: string; actorId: string; signedOn: string },
  f: DownloadedInvoiceFile,
): Promise<FrozenBill | null> {
  const type = sniffContentType(f.bytes);
  if (!type || !KEPT.has(type)) return { invoiceId: f.invoiceId, filename: f.filename, documentId: null, sha256: null };
  const filed = await fileGeneratedDocument(
    admin,
    orgId,
    {
      id: derivedUuid(`${input.certificationId}:bill:${f.invoiceId}:${f.index}`),
      subjectType: "roadside_inspection",
      subjectId: input.inspectionId,
      kind: "roadside_repair_bill",
      uploadedBy: input.actorId,
      capturedAt: input.signedOn,
      contentType: type,
    },
    f.bytes,
  );
  if ("code" in filed) return null;
  return { invoiceId: f.invoiceId, filename: f.filename, documentId: filed.documentId, sha256: filed.sha256 };
}
