import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveFullName, type DriverCreateRequest } from "@silvicom/shared";
import { writeAudit } from "../../lib/audit.js";

/**
 * The roster row a list shows (`GET /roster/drivers`) and a create answers with.
 *
 * Kept as ONE string literal (not concatenated): PostgREST's typings parse the select list at the
 * type level, and a concatenation widens to `string`, which collapses the row type to an error union.
 */
export const DRIVER_LIST_COLS =
  "id, full_name, status, employee_id, phone, email, driver_type, identity_source, app_access_enabled, user_id, cdl_number, cdl_expires_at, medical_card_expires_at, hire_date, created_at, archived_at";

/**
 * Create one driver row — the only way a `drivers` row is made by a person, and roster's to own
 * (docs/ARCHITECTURE.md §3: roster owns the human-facing CRUD).
 *
 * Moved out of `POST /roster/drivers` on 2026-11-03 (ads D1c) so recruiting's lead conversion creates its
 * applicant through the same door rather than a second insert into a table it does not own: a second copy
 * would have had to remember `identity_source: "manual"` (or the next Samsara sync overwrites the name)
 * and the `driver.created` audit row, and would have drifted the first time either changed. The route and
 * the conversion both call this; the caller decides who may.
 */
export async function createDriverRecord(
  admin: SupabaseClient,
  orgId: string,
  actorId: string,
  body: DriverCreateRequest,
): Promise<{ driver: Record<string, unknown> & { id: string } } | { error: "db_error" }> {
  // `full_name` is NOT NULL and is what the Samsara matcher and every existing surface reads, so
  // derive it when the admin filled only the structured parts. The contract guarantees one or the
  // other is present.
  const fullName = body.full_name?.trim() || deriveFullName(body);
  const { full_name: _ignored, ...rest } = body;
  const { data, error } = await admin
    .from("drivers")
    .insert({
      ...rest,
      org_id: orgId,
      full_name: fullName,
      // Never client-supplied: this row is admin-owned, so telematics must not overwrite its
      // identity fields on the next sync (plan §4).
      identity_source: "manual",
    })
    .select(DRIVER_LIST_COLS)
    .single();
  if (error || !data) return { error: "db_error" };

  const driver = data as unknown as Record<string, unknown> & { id: string };
  await writeAudit(admin, {
    orgId,
    actorId,
    action: "driver.created",
    entity: "drivers",
    entityId: driver.id,
    meta: { fullName },
  });
  return { driver };
}
