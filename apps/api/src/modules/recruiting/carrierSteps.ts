import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CarrierStep,
  CarrierStepCreate,
  CarrierStepFacts,
  CarrierStepLatest,
  CarrierStepRecordInput,
  CarrierStepUpdate,
} from "@silvicom/shared";
import { fetchAllPagedIn } from "../../lib/paging.js";
import { displayNameFor } from "../../lib/memberLabels.js";
import { readLiveInvitation } from "./applicantChecklist.js";

/**
 * The carrier's own hiring steps (HIRING-WORKFLOW-AUDIT-2026-10-31 §10 CE2; the tables are 0545) — the
 * list in Settings → Recruiting, the office's done / undone on one applicant, and the facts the checklist
 * folds. The fold decides (`hiringCarrierSteps.ts`); this only reads and writes.
 *
 * ── THE LIST ──────────────────────────────────────────────────────────────────────────────────
 * A step is retired, never deleted (CS010), and what proves it never changes (CS011): records name the
 * step, and a row that vanished or changed meaning would leave them pointing at nothing or certifying
 * what was never checked. So the update is the office's words, place, owes and the hire switch — or
 * retire, once (CS012).
 *
 * ── THE RECORD ────────────────────────────────────────────────────────────────────────────────
 * Append-only (CS020/CS021). The database checks the step is this carrier's and live (CS024/CS025), the
 * paper is this driver's (CS026/CS027) and an undo says why (CS028); those refusals come back as words.
 *
 * ⚠ Every query org-filters itself: the service role bypasses RLS.
 */

const COLS = "id, label, instructions, after_step, position, owes, proof, blocks_hire, created_at, retired_at";
const RECORD_COLS = "id, step_id, driver_id, act, note, document_id, recorded_by_name, recorded_at";

export type CarrierStepError = { status: number; code: string; message: string };
export const isCarrierStepError = (v: unknown): v is CarrierStepError =>
  typeof v === "object" && v !== null && "status" in v && "code" in v;

/** The live list, in checklist order's tie-breaks (place is the fold's). Throws on a failed read. */
export async function listCarrierSteps(admin: SupabaseClient, orgId: string): Promise<CarrierStep[]> {
  const { data, error } = await admin
    .from("hiring_carrier_steps")
    .select(COLS)
    .eq("org_id", orgId)
    .is("retired_at", null)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not read the hiring steps: ${error.message}`);
  return (data ?? []) as CarrierStep[];
}

/** A new step, last among the steps already placed after the same built-in one. */
export async function createCarrierStep(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  input: CarrierStepCreate,
): Promise<CarrierStep> {
  const siblings = (await listCarrierSteps(admin, orgId)).filter((s) => s.after_step === input.afterStep);
  const position = siblings.length === 0 ? 0 : Math.min(1000, Math.max(...siblings.map((s) => s.position)) + 1);
  const { data, error } = await admin
    .from("hiring_carrier_steps")
    .insert({
      org_id: orgId, label: input.label, instructions: input.instructions, after_step: input.afterStep,
      position, owes: input.owes, proof: input.proof, blocks_hire: input.blocksHire, created_by: userId,
    })
    .select(COLS)
    .single();
  if (error || !data) throw new Error(`Could not add the step: ${error?.message ?? "no row"}`);
  return data as CarrierStep;
}

/** Change a live step's words, place, owes or hire switch — or retire it (one-way, CS012). */
export async function updateCarrierStep(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  stepId: string,
  patch: CarrierStepUpdate,
  now: Date = new Date(),
): Promise<CarrierStep | CarrierStepError> {
  const changes: Record<string, unknown> = {};
  if (patch.label !== undefined) changes.label = patch.label;
  if (patch.instructions !== undefined) changes.instructions = patch.instructions;
  if (patch.afterStep !== undefined) changes.after_step = patch.afterStep;
  if (patch.position !== undefined) changes.position = patch.position;
  if (patch.owes !== undefined) changes.owes = patch.owes;
  if (patch.blocksHire !== undefined) changes.blocks_hire = patch.blocksHire;
  if (patch.retire) Object.assign(changes, { retired_at: now.toISOString(), retired_by: userId });
  const { data, error } = await admin
    .from("hiring_carrier_steps")
    .update(changes)
    .eq("org_id", orgId)
    .eq("id", stepId)
    // A retired step is finished: neither edited nor retired twice (CS012 says so too).
    .is("retired_at", null)
    .select(COLS);
  if (error) throw new Error(`Could not change the step: ${error.message}`);
  const row = ((data ?? []) as CarrierStep[])[0];
  if (!row) return { status: 404, code: "not_found", message: "That step is not on your list, or it was already removed." };
  return row;
}

type RecordRow = {
  id: string; step_id: string; driver_id: string; act: "done" | "undone"; note: string | null;
  document_id: string | null; recorded_by_name: string; recorded_at: string;
};

const latestOf = (r: RecordRow): CarrierStepLatest => ({
  stepId: r.step_id, act: r.act, at: r.recorded_at, byName: r.recorded_by_name, note: r.note, documentId: r.document_id,
});

/** The database's refusals, as words the drawer can show. */
const REFUSALS: Record<string, CarrierStepError> = {
  CS024: { status: 404, code: "not_found", message: "That step is not on your list." },
  CS025: { status: 409, code: "step_retired", message: "That step was removed from your list, so it can no longer be ticked." },
  CS026: { status: 422, code: "document_required", message: "This step is proved by a document — add the applicant's paper first." },
  CS027: { status: 422, code: "document_not_asked_for", message: "This step is a tick; it files no document." },
  CS028: { status: 422, code: "reason_required", message: "Say why you are taking this back." },
  CS022: { status: 404, code: "not_found", message: "That applicant is not one of yours." },
  CS023: { status: 404, code: "not_found", message: "That application is not this applicant's." },
};

/** One act on one applicant's step. The caller has already found the driver in this org. */
export async function recordCarrierStep(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  invitationId: string | null,
  stepId: string,
  actor: { userId: string; name: string },
  input: CarrierStepRecordInput,
): Promise<CarrierStepLatest | CarrierStepError> {
  const { data, error } = await admin
    .from("hiring_carrier_step_records")
    .insert({
      org_id: orgId, step_id: stepId, driver_id: driverId, invitation_id: invitationId, act: input.act,
      note: input.note, document_id: input.documentId, recorded_by: actor.userId, recorded_by_name: actor.name,
    })
    .select(RECORD_COLS)
    .single();
  if (error) {
    const refusal = error.code ? REFUSALS[error.code] : undefined;
    if (refusal) return refusal;
    throw new Error(`Could not record the step: ${error.message}`);
  }
  return latestOf(data as RecordRow);
}

export interface StepActor {
  userId: string;
  role: string | null;
  email: string | null;
}

/**
 * The office's act on one applicant, from the route: the driver must be this org's (a 404 otherwise —
 * another carrier's id reads as no id), the record names the applicant's live invitation when there is
 * one, and the name on it is the SESSION's (`displayNameFor`, then the email) — never the client's, so
 * nobody can tick a step as somebody else.
 */
export async function recordApplicantCarrierStep(
  admin: SupabaseClient,
  orgId: string,
  actor: StepActor,
  driverId: string,
  stepId: string,
  input: CarrierStepRecordInput,
): Promise<CarrierStepLatest | CarrierStepError> {
  const { data: driver, error } = await admin
    .from("drivers").select("id").eq("org_id", orgId).eq("id", driverId).maybeSingle();
  if (error) throw new Error(`Could not read the applicant: ${error.message}`);
  if (!driver) return { status: 404, code: "not_found", message: "Applicant not found" };
  const [invitation, name] = await Promise.all([
    readLiveInvitation(admin, orgId, driverId),
    displayNameFor(admin, actor.userId, orgId, actor.role),
  ]);
  const byName = (name ?? actor.email ?? "An office user").trim().slice(0, 200) || "An office user";
  return recordCarrierStep(admin, orgId, driverId, invitation?.id ?? null, stepId, { userId: actor.userId, name: byName }, input);
}

/**
 * The fold's facts for every driver, in two reads however many applicants: the live list once, and every
 * record on these drivers (paged, chunked — a board's ids in one `.in()` overflow the URL). The latest act
 * per (driver, step) wins: newest `recorded_at`, then `id` for two acts in one instant.
 */
export async function readCarrierStepFacts(
  admin: SupabaseClient,
  orgId: string,
  driverIds: readonly string[],
): Promise<Map<string, CarrierStepFacts>> {
  const out = new Map<string, CarrierStepFacts>();
  if (driverIds.length === 0) return out;
  const steps = await listCarrierSteps(admin, orgId);
  // A carrier with no steps of its own pays no second read.
  if (steps.length === 0) {
    for (const d of driverIds) out.set(d, { steps, latest: [] });
    return out;
  }
  type Page = PromiseLike<{ data: RecordRow[] | null; error: { message: string } | null }>;
  const rows = await fetchAllPagedIn<RecordRow>([...driverIds], (chunk) => (from, to) =>
    admin
      .from("hiring_carrier_step_records")
      .select(RECORD_COLS)
      .eq("org_id", orgId)
      .in("driver_id", chunk)
      .order("id")
      .range(from, to) as unknown as Page);
  const live = new Set(steps.map((s) => s.id));
  const latest = new Map<string, RecordRow>();
  for (const r of rows) {
    if (!live.has(r.step_id)) continue;
    const key = `${r.driver_id}:${r.step_id}`;
    const seen = latest.get(key);
    if (!seen || r.recorded_at > seen.recorded_at || (r.recorded_at === seen.recorded_at && r.id > seen.id)) latest.set(key, r);
  }
  for (const d of driverIds) {
    out.set(d, { steps, latest: [...latest.values()].filter((r) => r.driver_id === d).map(latestOf) });
  }
  return out;
}
