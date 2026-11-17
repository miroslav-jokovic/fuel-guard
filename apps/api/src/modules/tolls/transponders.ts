import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchAllPaged,
  fetchAllPagedIn,
  type AssignmentVoid,
  type TransponderAssignmentDto,
  type TransponderCreate,
  type TransponderDto,
  type TransponderMove,
  type TransponderRetire,
  type TransponderRetiredReason,
  type TollProvider,
} from "@silvicom/shared";
import { tracedFailure as traced } from "../../lib/serviceError.js";

/**
 * The fleet's toll tags and which truck carried each one, when (TOLLS-PER-TRUCK-PLAN.md TL2; the
 * tables are 0622's).
 *
 * ── EVERY WRITE IS ONE OF 0622'S FOUR FUNCTIONS ──────────────────────────────────────────────
 * Nothing here inserts or updates a row. A move is "close the open row, open the next one" and a
 * retirement is "close it, then stamp the tag", and either one done as two PostgREST calls can stop
 * halfway — a tag on no truck, or on two. The functions do each in one transaction under the tag's
 * row lock, and the trigger refuses an overlap whoever writes, so this file's job is to call them and
 * say what a refusal means in words the office can act on.
 *
 * ── THE TRUCK IS READ, NEVER STORED ON THE TAG ───────────────────────────────────────────────
 * `currentVehicleId` is the open, unvoided assignment, worked out on every read. A column on the tag
 * or on `vehicles` would be a second answer to "which truck has it", and the sync jobs that write
 * `vehicles` would sooner or later overwrite it (D-TL2).
 */

export interface TollServiceError {
  code: string;
  error: string;
  /** On `already_registered`: the tag that is on file, so the form can open it instead. */
  existing?: TransponderDto;
}

export const isTollServiceError = (v: unknown): v is TollServiceError =>
  typeof v === "object" && v !== null && "code" in v && "error" in v && !("history" in v);

/**
 * 0622's refusals, each with the sentence the office reads and the status it travels under. 409 is
 * "the fleet's history says no" (nothing in the form will fix it, the history must change first);
 * 422 is "the request names something unusable".
 */
const REFUSALS: Record<string, { status: number; code: string; error: string }> = {
  TL001: {
    status: 409,
    code: "tag_overlap",
    error: "That tag is already on a truck for part of that time. If that entry is wrong, void it first, then enter the right one.",
  },
  TL002: {
    status: 409,
    code: "assignment_frozen",
    error: "A past assignment is never edited. Void the wrong one and enter the right one.",
  },
  TL003: { status: 422, code: "not_on_fleet", error: "That tag, truck or entry is not on this company's fleet, or was already voided." },
  TL004: { status: 409, code: "tag_retired", error: "That tag was retired, so it cannot go on a truck after that date." },
  TL005: {
    status: 409,
    code: "move_before_current",
    error: "That date is before the tag's current truck got it. If the current entry is wrong, void it and enter the right one.",
  },
  "23514": { status: 422, code: "bad_dates", error: "An assignment has to end after it starts." },
};

export function statusForTollError(code: string): number {
  if (code === "already_registered") return 409;
  if (code === "not_found") return 404;
  return Object.values(REFUSALS).find((r) => r.code === code)?.status ?? 500;
}

function refusal(scope: string, error: { code?: string; message?: string }, publicMessage: string): TollServiceError {
  const known = error.code ? REFUSALS[error.code] : undefined;
  return known ? { code: known.code, error: known.error } : traced(`tolls.${scope}`, "db_error", publicMessage, error);
}

interface TagRow {
  id: string;
  provider: TollProvider;
  tag_number: string;
  issuer: string | null;
  note: string | null;
  retired_at: string | null;
  retired_reason: TransponderRetiredReason | null;
}

interface AssignmentRow {
  id: string;
  transponder_id: string;
  vehicle_id: string;
  valid_from: string;
  valid_to: string | null;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
}

const TAG_COLUMNS = "id, provider, tag_number, issuer, note, retired_at, retired_reason";
const ASSIGNMENT_COLUMNS = "id, transponder_id, vehicle_id, valid_from, valid_to, created_at, voided_at, void_reason";

/** Assemble the DTOs from three reads: the tags, every assignment of theirs, and the trucks named. */
async function assemble(admin: SupabaseClient, orgId: string, tags: TagRow[]): Promise<TransponderDto[]> {
  const tagIds = tags.map((t) => t.id);
  const assignments = await fetchAllPagedIn<AssignmentRow>(tagIds, (part) => (from, to) =>
    admin
      .from("toll_transponder_assignments")
      .select(ASSIGNMENT_COLUMNS)
      .eq("org_id", orgId)
      .in("transponder_id", part as string[])
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: AssignmentRow[] | null; error: { message: string } | null }>,
  );
  const vehicleIds = [...new Set(assignments.map((a) => a.vehicle_id))];
  const vehicles = await fetchAllPagedIn<{ id: string; unit_number: string }>(vehicleIds, (part) => (from, to) =>
    admin
      .from("vehicles")
      .select("id, unit_number")
      .eq("org_id", orgId)
      .in("id", part as string[])
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: Array<{ id: string; unit_number: string }> | null; error: { message: string } | null }>,
  );
  const unitOf = new Map(vehicles.map((v) => [v.id, v.unit_number]));

  const byTag = new Map<string, AssignmentRow[]>();
  for (const a of assignments) {
    const list = byTag.get(a.transponder_id) ?? [];
    list.push(a);
    byTag.set(a.transponder_id, list);
  }

  return tags.map((t) => {
    const rows = (byTag.get(t.id) ?? []).sort(newestFirst);
    const open = rows.find((a) => a.valid_to == null && a.voided_at == null);
    const history: TransponderAssignmentDto[] = rows.map((a) => ({
      id: a.id,
      vehicleId: a.vehicle_id,
      unitNumber: unitOf.get(a.vehicle_id) ?? null,
      validFrom: a.valid_from,
      validTo: a.valid_to,
      voidedAt: a.voided_at,
      voidReason: a.void_reason,
    }));
    return {
      id: t.id,
      provider: t.provider,
      tagNumber: t.tag_number,
      issuer: t.issuer,
      note: t.note,
      retiredAt: t.retired_at,
      retiredReason: t.retired_reason,
      currentVehicleId: open?.vehicle_id ?? null,
      history,
    };
  });
}

/** Newest assignment first; a voided row and its replacement share a start, and the live one leads. */
function newestFirst(a: AssignmentRow, b: AssignmentRow): number {
  const byStart = Date.parse(b.valid_from) - Date.parse(a.valid_from);
  if (byStart !== 0) return byStart;
  if ((a.voided_at == null) !== (b.voided_at == null)) return a.voided_at == null ? -1 : 1;
  return Date.parse(b.created_at) - Date.parse(a.created_at);
}

/** Tags in use first, then by provider and number, so the list reads the same on every load. */
function byUseThenNumber(a: TransponderDto, b: TransponderDto): number {
  if ((a.retiredAt == null) !== (b.retiredAt == null)) return a.retiredAt == null ? -1 : 1;
  return a.provider.localeCompare(b.provider) || a.tagNumber.localeCompare(b.tagNumber);
}

async function readTags(admin: SupabaseClient, orgId: string, ids?: readonly string[]): Promise<TagRow[]> {
  if (ids) {
    return fetchAllPagedIn<TagRow>(ids, (part) => (from, to) =>
      admin
        .from("toll_transponders")
        .select(TAG_COLUMNS)
        .eq("org_id", orgId)
        .in("id", part as string[])
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: TagRow[] | null; error: { message: string } | null }>,
    );
  }
  return fetchAllPaged<TagRow>((from, to) =>
    admin
      .from("toll_transponders")
      .select(TAG_COLUMNS)
      .eq("org_id", orgId)
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: TagRow[] | null; error: { message: string } | null }>,
  );
}

/**
 * Every tag the fleet holds, or — with `vehicleId` — every tag that truck has EVER carried, so the
 * truck page can show a tag that moved on last week next to the one it has now. Paged: PostgREST
 * answers at most 1,000 rows (memory `postgrest-caps-every-response-at-1000`), and two tags a truck
 * across 211 trucks is already near half that.
 */
export async function listTransponders(
  admin: SupabaseClient,
  orgId: string,
  opts: { vehicleId?: string } = {},
): Promise<TransponderDto[] | TollServiceError> {
  try {
    let ids: string[] | undefined;
    if (opts.vehicleId) {
      const held = await fetchAllPaged<{ transponder_id: string }>((from, to) =>
        admin
          .from("toll_transponder_assignments")
          .select("transponder_id")
          .eq("org_id", orgId)
          .eq("vehicle_id", opts.vehicleId!)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: Array<{ transponder_id: string }> | null; error: { message: string } | null }>,
      );
      ids = [...new Set(held.map((h) => h.transponder_id))];
      if (ids.length === 0) return [];
    }
    const tags = await readTags(admin, orgId, ids);
    return (await assemble(admin, orgId, tags)).sort(byUseThenNumber);
  } catch (e) {
    return traced("tolls.listTransponders", "db_error", "Could not load the toll tags", e);
  }
}

async function readOne(admin: SupabaseClient, orgId: string, id: string, scope: string): Promise<TransponderDto | TollServiceError> {
  try {
    const [tag] = await assemble(admin, orgId, await readTags(admin, orgId, [id]));
    return tag ?? { code: "not_found", error: "That toll tag is not on this company's fleet." };
  } catch (e) {
    return traced(`tolls.${scope}`, "db_error", "The change was saved, but the tag could not be read back. Reload the page", e);
  }
}

/**
 * Register a tag, on a truck from `at` (now when not given) or in the drawer. A tag already on file
 * comes back as `already_registered` WITH that tag, rather than as a second row or a bare refusal:
 * the office typed a number the fleet already holds, and what it needs next is that tag, to move it.
 */
export async function registerTransponder(
  admin: SupabaseClient,
  orgId: string,
  actor: string | null,
  input: TransponderCreate,
): Promise<TransponderDto | TollServiceError> {
  const vehicleId = input.vehicleId ?? null;
  const { data, error } = await admin.rpc("register_toll_transponder", {
    p_org_id: orgId,
    p_provider: input.provider,
    p_tag_number: input.tagNumber,
    p_issuer: input.issuer ?? null,
    p_note: input.note ?? null,
    p_vehicle_id: vehicleId,
    p_at: vehicleId ? (input.at ?? new Date().toISOString()) : null,
    p_actor: actor,
  });
  if (error) {
    if (error.code === "23505") {
      const { data: found } = await admin
        .from("toll_transponders")
        .select("id")
        .eq("org_id", orgId)
        .eq("provider", input.provider)
        .eq("tag_number", input.tagNumber)
        .maybeSingle();
      const existing = found ? await readOne(admin, orgId, (found as { id: string }).id, "registerTransponder") : null;
      return {
        code: "already_registered",
        error: "That tag is already on file. Open it to move it to another truck.",
        ...(existing && !isTollServiceError(existing) ? { existing } : {}),
      };
    }
    return refusal("registerTransponder", error, "Could not register the tag");
  }
  return readOne(admin, orgId, data as string, "registerTransponder");
}

/** Put a tag on a truck from `at`, or take it off (`vehicleId: null`). */
export async function moveTransponder(
  admin: SupabaseClient,
  orgId: string,
  actor: string | null,
  transponderId: string,
  input: TransponderMove,
): Promise<TransponderDto | TollServiceError> {
  const { error } = await admin.rpc("move_toll_transponder", {
    p_org_id: orgId,
    p_transponder_id: transponderId,
    p_vehicle_id: input.vehicleId,
    p_at: input.at,
    p_actor: actor,
  });
  if (error) return refusal("moveTransponder", error, "Could not move the tag");
  return readOne(admin, orgId, transponderId, "moveTransponder");
}

/** Retire a lost, returned, damaged or replaced tag; it comes off its truck at `at`. */
export async function retireTransponder(
  admin: SupabaseClient,
  orgId: string,
  actor: string | null,
  transponderId: string,
  input: TransponderRetire,
): Promise<TransponderDto | TollServiceError> {
  const { error } = await admin.rpc("retire_toll_transponder", {
    p_org_id: orgId,
    p_transponder_id: transponderId,
    p_at: input.at,
    p_reason: input.reason,
    p_actor: actor,
  });
  if (error) return refusal("retireTransponder", error, "Could not retire the tag");
  return readOne(admin, orgId, transponderId, "retireTransponder");
}

/**
 * Void a wrong assignment, with why. The row stays in the history (struck through on the card);
 * attribution stops using it, so every toll it touched moves to whichever truck the corrected
 * history names, with no re-stamping (D-TL3).
 */
export async function voidAssignment(
  admin: SupabaseClient,
  orgId: string,
  actor: string | null,
  assignmentId: string,
  input: AssignmentVoid,
): Promise<TransponderDto | TollServiceError> {
  const { data: row, error: readError } = await admin
    .from("toll_transponder_assignments")
    .select("transponder_id")
    .eq("org_id", orgId)
    .eq("id", assignmentId)
    .maybeSingle();
  if (readError) return traced("tolls.voidAssignment", "db_error", "Could not read that entry", readError);
  if (!row) return { code: "not_found", error: "That entry is not on this company's fleet." };
  const { error } = await admin.rpc("void_toll_transponder_assignment", {
    p_org_id: orgId,
    p_assignment_id: assignmentId,
    p_reason: input.reason,
    p_actor: actor,
  });
  if (error) return refusal("voidAssignment", error, "Could not void the entry");
  return readOne(admin, orgId, (row as { transponder_id: string }).transponder_id, "voidAssignment");
}
