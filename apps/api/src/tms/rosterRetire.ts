import type { SupabaseClient } from "@supabase/supabase-js";
import { DRIVER_STATUSES } from "@silvicom/shared";

/**
 * Retirement (M6) — the only operation in this module that takes capability away from a person, and
 * the only one that touches the retention clock. It is separate from the identity sweep for that
 * reason: it runs when an operator asks for it, not as a side effect of refreshing a licence expiry.
 *
 * WHAT IT WILL NOT DO, and why each one is a rule rather than an oversight:
 *
 *  · **Never clears a termination date.** D-MR7. Once a driver has left, that date starts a §391.51
 *    retention clock and the evidence tables are append-only. A re-hire (McLeod clearing the date) is
 *    surfaced for a human, never applied — the same posture the Samsara sync has always taken, where
 *    reactivation is an admin decision.
 *  · **Never creates.** A retirement for a record we have never linked is meaningless; there is
 *    nothing to retire. Reported, ignored.
 *  · **Never touches a row the office or the recruiting pipeline owns.** `identity_source = 'manual'`
 *    is office-owned; `status = 'applicant'` belongs to recruiting, whose lifecycle guard (0213)
 *    exempts the service role, so nothing below us would object.
 *  · **Never retires more rows in one call than are currently active.** The bad-fetch guard, carried
 *    over verbatim from `samsaraDriverSync` where it was written after a thin response nearly
 *    deactivated a fleet. It matters more here: McLeod holds 1,299 non-active driver records against
 *    164 active ones, so a mis-scoped sweep has an eight-to-one lever on the roster.
 */

export interface RetireInput {
  external_id: string;
  status: "inactive" | "terminated";
  termination_date?: string | null;
}

export interface RetireResult {
  received: number;
  retired: number;
  /** Already in the right state — the steady state once a roster has settled. */
  unchanged: number;
  /** Not linked to any Silvicom 360 row: nothing to retire. */
  unknown: string[];
  /** Left alone because the office or the recruiting pipeline owns the row. */
  skippedOwned: string[];
  /** McLeod cleared a termination date. Surfaced for a human; never applied. */
  rehires: string[];
  /** Set when the whole call was refused by the bad-fetch guard, with the reason. */
  refused?: string;
}

const LINK = {
  drivers: "mcleod_driver_id",
  vehicles: "mcleod_tractor_id",
  trailers: "mcleod_trailer_id",
} as const;

type Entity = keyof typeof LINK;

interface Row {
  id: string;
  link: string;
  status: string | null;
  identity_source: string | null;
  termination_date?: string | null;
}

export async function retireFromTms(
  admin: SupabaseClient,
  orgId: string,
  entity: Entity,
  rows: RetireInput[],
): Promise<RetireResult> {
  const out: RetireResult = {
    received: rows.length,
    retired: 0,
    unchanged: 0,
    unknown: [],
    skippedOwned: [],
    rehires: [],
  };
  const link = LINK[entity];

  const sel = entity === "drivers" ? `id, ${link}, status, identity_source, termination_date` : `id, ${link}, status, identity_source`;
  const { data, error } = await admin.from(entity).select(sel).eq("org_id", orgId).not(link, "is", null);
  if (error) throw new Error(error.message);
  const linked = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    link: String(r[link]),
    status: (r.status as string | null) ?? null,
    identity_source: (r.identity_source as string | null) ?? null,
    termination_date: (r.termination_date as string | null) ?? null,
  })) as Row[];
  const byLink = new Map(linked.map((r) => [r.link, r]));

  // ── the bad-fetch guard ──────────────────────────────────────────────────────────────────────
  // Count what a full application of this payload would retire, and refuse the WHOLE call if that
  // exceeds the number of rows currently active. Refusing wholesale rather than trimming is the point:
  // a payload this large is not a big layoff, it is a broken query, and applying the first N of it
  // would be worse than applying none.
  const active = linked.filter((r) => r.status === "active").length;
  const wouldRetire = rows.filter((i) => byLink.get(i.external_id)?.status === "active").length;
  // A single sweep may retire at most HALF the active roster, and always at least one row.
  //
  // Two earlier shapes were wrong and the failures were instructive. `wouldRetire > active` let a
  // payload empty the roster entirely. `wouldRetire >= active` caught that but refused the ordinary
  // case of a one-driver fleet losing its driver. The distinguishing feature of a bad fetch is not its
  // relation to the roster's edge, it is VOLUME: normal turnover retires a handful, a mis-scoped query
  // retires everything. McLeod holds 1,299 non-active driver records against 164 active ones, so the
  // lever is eight to one and the threshold has room to be generous.
  //
  // `Math.max(1, …)` keeps a tiny roster workable; the fraction keeps a real one safe.
  const cap = Math.max(1, Math.floor(active / 2));
  if (active > 0 && wouldRetire > cap) {
    out.refused =
      `would retire ${wouldRetire} of ${active} active ${entity} (cap ${cap}) — treating as a bad fetch`;
    return out;
  }

  for (const input of rows) {
    const row = byLink.get(input.external_id);
    if (!row) {
      out.unknown.push(input.external_id);
      continue;
    }
    if (row.identity_source === "manual" || row.status === "applicant") {
      out.skippedOwned.push(input.external_id);
      continue;
    }
    // A termination date already on the row is never unset, and never moved by a payload that has none.
    if (entity === "drivers" && row.termination_date && !input.termination_date) {
      out.rehires.push(input.external_id);
      continue;
    }
    if (row.status === input.status) {
      out.unchanged++;
      continue;
    }

    const patch: Record<string, unknown> = { status: input.status };
    if (entity === "drivers" && input.termination_date && !row.termination_date) {
      patch.termination_date = input.termination_date;
    }
    // The vocabulary lives in shared and `drivers.status` has no CHECK constraint behind it until
    // 0240, so a mapping bug would otherwise write a novel status and every `status = 'active'` query
    // in the product would quietly exclude those rows.
    if (!(DRIVER_STATUSES as readonly string[]).includes(input.status)) continue;

    const { error: upErr } = await admin.from(entity).update(patch).eq("id", row.id).eq("org_id", orgId);
    if (!upErr) out.retired++;
  }
  return out;
}
