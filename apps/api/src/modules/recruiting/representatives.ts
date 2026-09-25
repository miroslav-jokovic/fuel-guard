import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DOCUMENTS_BUCKET, type CarrierRepresentative, type CarrierRepresentativeCreate } from "@silvicom/shared";
import { pngBytes } from "./roadTest.js";

/**
 * The people who sign for the carrier — HANDBOOK-SIGNING-PLAN.md HB3 (D-HB3).
 *
 * The owner: *"We can create Representative that will be in charge and that we can manage add or
 * delete, same way as we did for Inspectors in Maintenance."* So this is `inspections/inspectors.ts`'s
 * shape: the office adds a person with their signature, and deletes them. ⚠ The delete is ATTEMPTED
 * and 0374's `on delete restrict` decides it: a Representative who has countersigned a handbook is
 * named by a `handbook_marks` row, and Postgres refuses with **23001** (`restrict_violation`, not
 * 23503; measured in `handbook-signing.test.mjs`). That becomes a 409 with a sentence, never a 500.
 *
 * ⚠ A row is never edited (HB010). A new title or signature is a new Representative, so a filed
 * handbook's countersignature always traces to the row that supplied it.
 *
 * ⚠ The service role bypasses RLS: every query below filters on `org_id` itself.
 */

export interface RepresentativeError {
  code: "not_found" | "invalid_request" | "storage_failed" | "insert_failed" | "has_signed" | "delete_failed";
  message: string;
}

export const isRepresentativeError = (v: unknown): v is RepresentativeError =>
  typeof v === "object" && v !== null && "code" in v && "message" in v;

const COLS = "id, full_name, title, created_at";

export async function listRepresentatives(admin: SupabaseClient, orgId: string): Promise<CarrierRepresentative[]> {
  const { data } = await admin
    .from("carrier_representatives")
    .select(COLS)
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  return (data ?? []) as CarrierRepresentative[];
}

export async function addRepresentative(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  body: CarrierRepresentativeCreate,
): Promise<CarrierRepresentative | RepresentativeError> {
  const png = pngBytes(body.signature_png);
  if (!png) return { code: "invalid_request", message: "The signature must be a PNG image." };
  const id = randomUUID();
  // The org's OWN folder: 0374's CHECK refuses any other, so this cannot drift from it silently.
  const path = `${orgId}/representatives/${id}.png`;
  const upload = await admin.storage.from(DOCUMENTS_BUCKET).upload(path, png, { contentType: "image/png", upsert: false });
  if (upload.error) return { code: "storage_failed", message: "Could not store the signature." };
  const { data, error } = await admin
    .from("carrier_representatives")
    .insert({ id, org_id: orgId, full_name: body.full_name.trim(), title: body.title.trim(), signature_path: path, created_by: userId })
    .select(COLS)
    .single();
  if (error || !data) return { code: "insert_failed", message: "Could not add the representative." };
  return data as CarrierRepresentative;
}

export async function deleteRepresentative(
  admin: SupabaseClient,
  orgId: string,
  representativeId: string,
): Promise<{ id: string } | RepresentativeError> {
  const { data, error } = await admin
    .from("carrier_representatives")
    .delete()
    .eq("org_id", orgId)
    .eq("id", representativeId)
    .select("id, signature_path")
    .maybeSingle();
  if (error) {
    if (error.code === "23001" || error.code === "23503") {
      return {
        code: "has_signed",
        message: "This representative has signed a driver handbook, so they stay on file. Add a new representative instead.",
      };
    }
    return { code: "delete_failed", message: "Could not remove the representative." };
  }
  const row = data as { id: string; signature_path: string } | null;
  if (!row) return { code: "not_found", message: "That representative is not on file." };
  // The picture of somebody who signed nothing goes with them. Best effort: a leftover file costs
  // storage, never correctness, and the row that pointed at it is gone.
  await admin.storage.from(DOCUMENTS_BUCKET).remove([row.signature_path]);
  return { id: row.id };
}

/** The Representative as the renderer draws them: name, title and signature, from this org only. */
export async function representativeForPrint(
  admin: SupabaseClient,
  orgId: string,
  representativeId: string,
): Promise<{ id: string; fullName: string; title: string; signature: Buffer | null } | null> {
  const { data } = await admin
    .from("carrier_representatives")
    .select("id, full_name, title, signature_path")
    .eq("org_id", orgId)
    .eq("id", representativeId)
    .maybeSingle();
  const row = data as { id: string; full_name: string; title: string; signature_path: string } | null;
  if (!row) return null;
  // A missing file costs the picture, never the document: the renderer prints the typed name instead.
  const file = await admin.storage.from(DOCUMENTS_BUCKET).download(row.signature_path);
  const signature = file.data ? Buffer.from(await file.data.arrayBuffer()) : null;
  return { id: row.id, fullName: row.full_name, title: row.title, signature };
}
