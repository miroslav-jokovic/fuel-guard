import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Numbers this org must not text (A-11, G-2, C2d2) — `sms_suppressions`' only writer.
 *
 * ── WHY A SECOND TABLE WHEN A STOP ALREADY REVOKES THE CONSENTS ────────────────────────────────
 * A revocation is a fact about one agreement; a STOP is a fact about the NUMBER. Before C2d2 a number
 * that had texted STOP could be agreed again on the application page — the applicant's, or a second
 * link's — and was texted at once, although the only word that number had ever sent us was STOP. The
 * suppression is the number's own record: a STOP writes it, START lifts it, and every send path asks
 * it before anything else (`isSuppressed`).
 *
 * ── ONLY THE KEYWORD WRITES ONE ───────────────────────────────────────────────────────────────
 * Turning texts off on the application page revokes the consent and writes no suppression, and turning
 * them back on there works. The two roads mirror each other: what was said by text is undone by text
 * (START), what was pressed on the page is undone on the page. Whether the toll-free network also
 * keeps its own STOP list, and refuses our texts until START, is unmeasured (SMS-OPT-IN-PLAN §7) — if it
 * does, this table agrees with it; if it does not, this table is the only list there is.
 *
 * ⚠ Every write is org-filtered. The inbound webhook names no tenant, so `liftStopSuppressions` reads
 * which orgs hold the number first and then writes each through its own org — the same shape
 * `handleInboundSms` uses for the consents.
 */

/** 0376's reasons. Only `stop` has a writer today; the others wait for theirs (receipts, the office). */
export type SuppressionReason = "stop" | "carrier_block" | "invalid" | "manual";

/** Is this number suppressed for this org? Asked by every send path, and by agreeing (C2d2). */
export async function isSuppressed(admin: SupabaseClient, orgId: string, phone: string): Promise<boolean> {
  const { data } = await admin
    .from("sms_suppressions")
    // The service role bypasses RLS; this query carries its own tenant scope.
    .select("id")
    .eq("org_id", orgId)
    .eq("phone", phone)
    .is("lifted_at", null)
    .limit(1)
    .maybeSingle();
  return data !== null;
}

/**
 * Suppress a number. Idempotent: 0376 allows one live row per (org, phone), so a second STOP answers
 * the unique violation and is already done — the first one's row, and its reason, stand.
 */
export async function suppressNumber(
  admin: SupabaseClient,
  orgId: string,
  driverId: string | null,
  phone: string,
  reason: SuppressionReason,
): Promise<boolean> {
  const { error } = await admin
    .from("sms_suppressions")
    .insert({ org_id: orgId, driver_id: driverId, phone, reason });
  if (!error) return true;
  if ((error as { code?: string }).code === "23505") return false;
  throw new Error(`could not suppress the number: ${error.message}`);
}

/**
 * A START: lift every live STOP suppression on the number, in each org that holds one. A suppression
 * for any other reason stays — a carrier's block or the office's own hold is not the applicant's to
 * lift by text.
 */
export async function liftStopSuppressions(admin: SupabaseClient, phone: string, now: Date): Promise<number> {
  const { data } = await admin
    .from("sms_suppressions")
    .select("org_id")
    .eq("phone", phone)
    .eq("reason", "stop")
    .is("lifted_at", null);
  const orgs = [...new Set(((data ?? []) as { org_id: string }[]).map((r) => r.org_id))];

  let lifted = 0;
  for (const orgId of orgs) {
    const { data: rows } = await admin
      .from("sms_suppressions")
      .update({ lifted_at: now.toISOString() })
      .eq("org_id", orgId)
      .eq("phone", phone)
      .eq("reason", "stop")
      .is("lifted_at", null)
      .select("id");
    lifted += ((rows ?? []) as unknown[]).length;
  }
  return lifted;
}
