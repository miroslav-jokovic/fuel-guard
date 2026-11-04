import type { SupabaseClient } from "@supabase/supabase-js";
import type { CarrierQuestion, CarrierQuestionCreate, CarrierQuestionUpdate } from "@silvicom/shared";

/**
 * The carrier's own application questions (HIRING-WORKFLOW-AUDIT-2026-10-31 §15.3 CQ2; the table is 0567) —
 * the list in Settings → Recruiting, and what the office's Send stamps on an invitation.
 *
 * A question is retired, never deleted (CQ010), and what it asks — wording, kind, choices — never changes
 * (CQ011): an answer must stay readable beside exactly the question asked. So the update is the hint,
 * `required` and the place — or retire, once (CQ012). At most 20 live (CQ013), refused as words.
 *
 * ⚠ Every query org-filters itself: the service role bypasses RLS.
 */

const COLS = "id, wording, hint, kind, choices, required, position, created_at, retired_at";

export type CarrierQuestionError = { status: number; code: string; message: string };
export const isCarrierQuestionError = (v: unknown): v is CarrierQuestionError =>
  typeof v === "object" && v !== null && "status" in v && "code" in v;

const FULL: CarrierQuestionError = {
  status: 409, code: "questions_full", message: "You already ask 20 questions of your own. Remove one before adding another.",
};

/** The live list, in the order the applicant is asked it. Throws on a failed read. */
export async function listCarrierQuestions(admin: SupabaseClient, orgId: string): Promise<CarrierQuestion[]> {
  const { data, error } = await admin
    .from("recruiting_carrier_questions")
    .select(COLS)
    .eq("org_id", orgId)
    .is("retired_at", null)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not read your questions: ${error.message}`);
  return (data ?? []) as CarrierQuestion[];
}

/** A new question, last on the list. */
export async function createCarrierQuestion(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  input: CarrierQuestionCreate,
): Promise<CarrierQuestion | CarrierQuestionError> {
  const live = await listCarrierQuestions(admin, orgId);
  const position = live.length === 0 ? 0 : Math.min(1000, Math.max(...live.map((q) => q.position)) + 1);
  const { data, error } = await admin
    .from("recruiting_carrier_questions")
    .insert({
      org_id: orgId, wording: input.wording, hint: input.hint, kind: input.kind, choices: input.choices,
      required: input.required, position, created_by: userId,
    })
    .select(COLS)
    .single();
  if (error?.code === "CQ013") return FULL;
  if (error || !data) throw new Error(`Could not add the question: ${error?.message ?? "no row"}`);
  return data as CarrierQuestion;
}

/** Change a live question's hint, `required` or place — or retire it (one-way, CQ012). */
export async function updateCarrierQuestion(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  questionId: string,
  patch: CarrierQuestionUpdate,
  now: Date = new Date(),
): Promise<CarrierQuestion | CarrierQuestionError> {
  const changes: Record<string, unknown> = {};
  if (patch.hint !== undefined) changes.hint = patch.hint;
  if (patch.required !== undefined) changes.required = patch.required;
  if (patch.position !== undefined) changes.position = patch.position;
  if (patch.retire) Object.assign(changes, { retired_at: now.toISOString(), retired_by: userId });
  const { data, error } = await admin
    .from("recruiting_carrier_questions")
    .update(changes)
    .eq("org_id", orgId)
    .eq("id", questionId)
    .is("retired_at", null)
    .select(COLS);
  if (error) throw new Error(`Could not change the question: ${error.message}`);
  const row = ((data ?? []) as CarrierQuestion[])[0];
  if (!row) return { status: 404, code: "not_found", message: "That question is not on your list, or it was already removed." };
  return row;
}
