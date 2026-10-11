import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isIncidentTransitionAllowed,
  type CardFraudIncidentStatus,
  type CardFraudIncidentTransition,
} from "@silvicom/shared";

/**
 * A person moves a card-fraud incident: investigate, resolve, dismiss, or reopen (F02-F04 chunk 8c2).
 *
 * It mirrors `transition_anomaly` (0158) field for field, because 0438 gave incidents the same words:
 * the person who acts takes the incident (`assigned_to`), a close records who decided and when and the
 * disposition, and a reopen clears them. One UPDATE guarded by the version the person read, so a second
 * person's change, or the recorder extending the incident with a new attempt (`card_fraud_record` bumps
 * the version too), turns into a conflict instead of being overwritten. The recorder never extends a
 * closed incident; the next attempt on that card opens a new one, so closing loses nothing.
 *
 * ⚠ No transitions table: an incident's history is its `audit_logs` rows (`card_fraud.status_changed`,
 * written by the route), one per move. A history table would be a migration for a page that has 0
 * incidents on production today; the audit row answers who, when and what.
 *
 * Lives here, not in the inbox, because `card_fraud_incidents` is this module's table (0438,
 * `table-writers.json`).
 */
export type IncidentTransitionResult =
  | { ok: true; from: CardFraudIncidentStatus; to: CardFraudIncidentStatus; version: number }
  | { ok: false; code: "not_found" | "conflict" | "invalid_transition"; message: string };

export async function transitionCardFraudIncident(
  admin: SupabaseClient,
  orgId: string,
  id: string,
  actorId: string,
  t: CardFraudIncidentTransition,
  now: Date = new Date(),
): Promise<IncidentTransitionResult> {
  const { data: cur } = await admin
    .from("card_fraud_incidents")
    .select("id, status, version")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  const row = cur as { status: CardFraudIncidentStatus; version: number } | null;
  if (!row) return { ok: false, code: "not_found", message: "That incident is not in your queue." };
  if (row.version !== t.version) {
    return { ok: false, code: "conflict", message: "Someone changed this incident. Reload it and try again." };
  }
  const to = t.status as CardFraudIncidentStatus;
  if (!isIncidentTransitionAllowed(row.status, to)) {
    return { ok: false, code: "invalid_transition", message: `An incident cannot move from ${row.status} to ${to}.` };
  }

  const closing = to === "resolved" || to === "dismissed";
  const at = now.toISOString();
  const { data: written } = await admin
    .from("card_fraud_incidents")
    .update({
      status: to,
      version: row.version + 1,
      resolution_note: t.note?.trim() || null,
      assigned_to: actorId,
      disposition: closing ? t.disposition : null,
      disposition_by: closing ? actorId : null,
      disposition_at: closing ? at : null,
      updated_at: at,
    })
    .eq("id", id)
    .eq("org_id", orgId)
    .eq("version", row.version)
    .select("id, version");
  const done = (written ?? []) as { version: number }[];
  if (done.length !== 1) {
    return { ok: false, code: "conflict", message: "Someone changed this incident. Reload it and try again." };
  }
  return { ok: true, from: row.status, to, version: done[0]!.version };
}
