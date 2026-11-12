import type { SupabaseRecorder } from "./supabaseRecorder.js";

/**
 * The `application_edits` rows an office correction sent, read off its `correct_*` call (`p_edits`).
 *
 * Since 0593 (Q-AM14) the rows are not a table insert any more: they travel with the change, and
 * `record_application_edits` writes both in one transaction. So a test asks the call what it carried,
 * where it once asked `writtenRows("application_edits")`. A call with no rows sends null, read as none.
 */
export function editsSent(rec: SupabaseRecorder): Array<Record<string, unknown>> {
  return rec
    .rpcs()
    .filter((r) => r.fn.startsWith("correct_"))
    .flatMap((r) => ((r.args as { p_edits?: Array<Record<string, unknown>> | null }).p_edits ?? []));
}

/** Who the `correct_*` call names as the editor (`p_edited_by`), or undefined when none was made. */
export function editedBy(rec: SupabaseRecorder): unknown {
  const call = rec.rpcs().find((r) => r.fn.startsWith("correct_"));
  return call ? (call.args as { p_edited_by?: unknown }).p_edited_by : undefined;
}
