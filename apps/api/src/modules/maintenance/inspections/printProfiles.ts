import type { SupabaseClient } from "@supabase/supabase-js";
import { traced } from "./serviceError.js";
import type { ServiceError } from "./inspectors.js";

/**
 * Printer calibration for the pre-printed pads (plan step B5/A8, D-AVI8).
 *
 * An offset belongs to a PRINTER. Two people printing the same report from two machines must get
 * the same page, and a second printer must be able to exist without making the first one's numbers
 * wrong — which is why this is a row per machine rather than a pair of columns on the organisation
 * or a value in somebody's browser.
 */

export interface PrintProfile {
  id: string;
  name: string;
  layout_key: string;
  offset_x_pt: number;
  offset_y_pt: number;
  notes: string | null;
}

const COLUMNS = "id, name, layout_key, offset_x_pt, offset_y_pt, notes";

export async function listPrintProfiles(
  admin: SupabaseClient,
  orgId: string,
): Promise<PrintProfile[] | ServiceError> {
  const { data, error } = await admin
    .from("maintenance_print_profiles")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .order("name", { ascending: true });
  if (error) return traced("listPrintProfiles", "db_error", "Could not load the printer setups", error);
  return (data ?? []).map(toProfile);
}

export async function getPrintProfile(
  admin: SupabaseClient,
  orgId: string,
  id: string,
): Promise<PrintProfile | null | ServiceError> {
  const { data, error } = await admin
    .from("maintenance_print_profiles")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) return traced("getPrintProfile", "db_error", "Could not load the printer setup", error);
  return data ? toProfile(data) : null;
}

export interface PrintProfileInput {
  name: string;
  offsetXPt: number;
  offsetYPt: number;
  notes?: string | null;
}

export async function upsertPrintProfile(
  admin: SupabaseClient,
  orgId: string,
  createdBy: string | null,
  input: PrintProfileInput,
  id?: string,
): Promise<{ id: string } | ServiceError> {
  if (id) {
    // An UPDATE and not an upsert: the row exists, and `.upsert()` with a partial payload has
    // Postgres check NOT NULL before conflict arbitration (`lint:upserts`).
    const { error, count } = await admin
      .from("maintenance_print_profiles")
      .update(
        { name: input.name.trim(), offset_x_pt: input.offsetXPt, offset_y_pt: input.offsetYPt, notes: input.notes ?? null },
        { count: "exact" },
      )
      .eq("org_id", orgId)
      .eq("id", id);
    if (error) return traced("upsertPrintProfile.update", "update_failed", "Could not save the printer setup", error);
    if (!count) return { error: "Print profile not found", code: "not_found" };
    return { id };
  }
  const { data, error } = await admin
    .from("maintenance_print_profiles")
    .insert({
      org_id: orgId,
      name: input.name.trim(),
      offset_x_pt: input.offsetXPt,
      offset_y_pt: input.offsetYPt,
      notes: input.notes ?? null,
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (error || !data) return traced("upsertPrintProfile.insert", "insert_failed", "Could not save the printer setup", error);
  return { id: (data as { id: string }).id };
}

function toProfile(row: unknown): PrintProfile {
  const r = row as {
    id: string;
    name: string;
    layout_key: string;
    offset_x_pt: number | string;
    offset_y_pt: number | string;
    notes: string | null;
  };
  return {
    id: r.id,
    name: r.name,
    layout_key: r.layout_key,
    // `numeric` arrives as a string from PostgREST; a string offset would concatenate rather than
    // shift, which is the kind of bug that prints a page an inch away and looks like a typo.
    offset_x_pt: Number(r.offset_x_pt),
    offset_y_pt: Number(r.offset_y_pt),
    notes: r.notes,
  };
}
