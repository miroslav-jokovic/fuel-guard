import type { SupabaseClient } from "@supabase/supabase-js";
import {
  dayInZone,
  fetchAllPaged,
  isInServiceVehicleStatus,
  organizationTimezone,
  planTollTagImport,
  type ImportVehicle,
  type PlannedTollTagLine,
  type TollTagImport,
  type TollTagImportResult,
} from "@silvicom/shared";
import { writeAudit } from "../../lib/audit.js";
import { tracedFailure as traced } from "../../lib/serviceError.js";
import { isTollServiceError, listTransponders, type TollServiceError } from "./transponders.js";

/**
 * A spreadsheet of toll tags, applied (TOLLS-PER-TRUCK-PLAN.md TL2b). The browser has already shown
 * the office what each line will do; this runs the SAME planner (`planTollTagImport`) again on what is
 * on file now, because the preview is advice and someone may have moved a tag since. Then each line
 * is one of 0622's functions, called exactly as the tag dialog's routes call them, and each write is
 * audited with `via: "import"` and its line number.
 *
 * ── ONE LINE NEVER STOPS THE NEXT ────────────────────────────────────────────────────────────
 * A refused line (the history said no at the last moment) is reported with the office's sentence and
 * the import goes on. Lines are independent facts about independent tags; the sheet is not a
 * transaction, and holding 200 correct tags hostage to one typo would only make the office re-import.
 *
 * ── STARTING EARLIER IS VOID-THEN-PUT-BACK, AND PUT BACK AGAIN IF THAT FAILS ─────────────────
 * 0622 refuses to slide an open entry's start earlier (TL005) on purpose: the honest correction of a
 * wrong start is to void it. So `backdate` is two calls — void the entry with the reason in words,
 * then put the tag on the same truck from the sheet's day. They are not one transaction, so if the
 * second is refused the first is undone the only way history allows: the tag goes back on from the
 * entry's original start, and the line is reported as refused. The tag is never left on no truck.
 */

const VOID_REASON = (day: string) => `Start corrected by the toll tag import: on this truck since ${day}`;

async function fleetVehicles(admin: SupabaseClient, orgId: string): Promise<ImportVehicle[]> {
  const rows = await fetchAllPaged<{ id: string; unit_number: string; status: string | null }>((from, to) =>
    admin
      .from("vehicles")
      .select("id, unit_number, status")
      .eq("org_id", orgId)
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: Array<{ id: string; unit_number: string; status: string | null }> | null; error: { message: string } | null }>,
  );
  return rows.map((v) => ({ id: v.id, unitNumber: v.unit_number, inService: isInServiceVehicleStatus(v.status) }));
}

async function orgZone(admin: SupabaseClient, orgId: string): Promise<string> {
  const { data } = await admin.from("organizations").select("operating_hours").eq("id", orgId).maybeSingle();
  return organizationTimezone((data as { operating_hours?: object | null } | null)?.operating_hours);
}

/** 0622's refusal codes as the import's one-line reason. The dialog's sentences say the same. */
const REFUSED: Record<string, string> = {
  TL001: "Another truck had this tag for part of that time. Correct that truck's entry first.",
  TL003: "That tag or truck is not on this company's fleet.",
  TL004: "This tag was retired, so it cannot go on a truck after that day.",
  TL005: "Another truck got this tag after that day. Correct that truck's entry first.",
  "23505": "This tag was added by someone else a moment ago. Import the sheet again to place it.",
};
const refusedFor = (e: { code?: string }) => REFUSED[e.code ?? ""] ?? "Could not save this line. Try the import again.";

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;

async function applyLine(rpc: Rpc, orgId: string, actor: string, zone: string, p: PlannedTollTagLine): Promise<TollTagImportResult & { auditAction?: string; entityId?: string }> {
  const { item, verdict: v } = p;
  const base = { line: item.line, message: null };
  if (v.kind === "refused") return { ...base, outcome: "refused", message: v.reason };
  if (v.kind === "unchanged") return { ...base, outcome: "unchanged" };

  if (v.kind === "add") {
    const { data, error } = await rpc("register_toll_transponder", {
      p_org_id: orgId,
      p_provider: item.provider,
      p_tag_number: item.tagNumber,
      p_issuer: item.issuer ?? null,
      p_note: null,
      p_vehicle_id: v.vehicleId,
      p_at: item.at,
      p_actor: actor,
    });
    if (error) return { ...base, outcome: "refused", message: refusedFor(error) };
    return { ...base, outcome: "added", auditAction: "tolls.transponder_registered", entityId: data as string };
  }

  const move = (at: string) =>
    rpc("move_toll_transponder", { p_org_id: orgId, p_transponder_id: v.transponderId, p_vehicle_id: v.vehicleId, p_at: at, p_actor: actor });

  if (v.kind === "move") {
    const { error } = await move(item.at);
    if (error) return { ...base, outcome: "refused", message: refusedFor(error) };
    return { ...base, outcome: "moved", auditAction: "tolls.transponder_moved", entityId: v.transponderId };
  }

  const { error: voidError } = await rpc("void_toll_transponder_assignment", {
    p_org_id: orgId,
    p_assignment_id: v.entryId,
    p_reason: VOID_REASON(dayInZone(item.at, zone)),
    p_actor: actor,
  });
  if (voidError) return { ...base, outcome: "refused", message: refusedFor(voidError) };
  const { error } = await move(item.at);
  if (error) {
    await move(v.previousFrom);
    return { ...base, outcome: "refused", message: refusedFor(error) };
  }
  return { ...base, outcome: "backdated", auditAction: "tolls.transponder_backdated", entityId: v.transponderId };
}

export async function importTollTags(
  admin: SupabaseClient,
  orgId: string,
  actor: string,
  input: TollTagImport,
  now: Date = new Date(),
): Promise<TollTagImportResult[] | TollServiceError> {
  const tags = await listTransponders(admin, orgId);
  if (isTollServiceError(tags)) return tags;
  let vehicles: ImportVehicle[];
  let zone: string;
  try {
    [vehicles, zone] = await Promise.all([fleetVehicles(admin, orgId), orgZone(admin, orgId)]);
  } catch (e) {
    return traced("tolls.importTollTags", "db_error", "Could not read the fleet's trucks", e);
  }
  const planned = planTollTagImport(
    input.rows.map((r) => ({ ...r, issuer: r.issuer ?? null })),
    { tags, vehicles, now, zone },
  );

  const rpc: Rpc = async (fn, args) => {
    const { data, error } = await admin.rpc(fn, args);
    return { data, error: error as { code?: string; message?: string } | null };
  };
  const results: TollTagImportResult[] = [];
  for (const p of planned) {
    const r = await applyLine(rpc, orgId, actor, zone, p);
    if (r.auditAction && r.entityId) {
      await writeAudit(admin, {
        orgId,
        actorId: actor,
        action: r.auditAction,
        entity: "toll_transponders",
        entityId: r.entityId,
        meta: { via: "import", line: p.item.line, provider: p.item.provider, tagNumber: p.item.tagNumber, unitNumber: p.item.unitNumber, at: p.item.at },
      });
    }
    results.push({ line: r.line, outcome: r.outcome, message: r.message });
  }
  return results;
}
