/**
 * The exception ledger's reads and its lifecycle moves.
 *
 * ── WHY A SERVICE AND NOT INLINE HANDLERS ────────────────────────────────────────────────────────
 * Split from the route on day one, per the house rule for anything with more than a couple of verbs.
 * Producing findings is `sync_fuel_exceptions` (an RPC, because closing what a run no longer finds is
 * a set operation); everything a PERSON does to a finding lives here, because each of those moves has
 * to write an act-log row in the same breath and that pairing must not be optional.
 *
 * ── THE SERVICE ROLE BYPASSES RLS ────────────────────────────────────────────────────────────────
 * Every query carries its own `.eq("org_id", …)`. That filter is the only tenant boundary this code
 * has, and `expectOrgScoped` asserts it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FUEL_EXCEPTION_OPEN_STATUSES,
  type FuelExceptionKind,
  type FuelExceptionStatus,
} from "@silvicom/shared";

export interface ExceptionFilters {
  status?: FuelExceptionStatus[] | null;
  kind?: FuelExceptionKind[] | null;
  assignedTo?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
}

const COLS =
  "id, kind, run_id, transaction_id, occurred_on, amount, amount_kind, unit_number, site_number, " +
  "city, state, brand, evidence, fingerprint, status, assigned_to, resolved_by, resolved_at, " +
  "resolution_note, credited_amount, credited_on, first_seen_at, last_seen_at";

export async function listExceptions(
  admin: SupabaseClient,
  orgId: string,
  f: ExceptionFilters = {},
): Promise<{ rows: unknown[]; total: number }> {
  let q = admin.from("fuel_exceptions").select(COLS, { count: "exact" }).eq("org_id", orgId);
  if (f.status?.length) q = q.in("status", f.status);
  if (f.kind?.length) q = q.in("kind", f.kind);
  if (f.assignedTo) q = q.eq("assigned_to", f.assignedTo);
  if (f.from) q = q.gte("occurred_on", f.from);
  if (f.to) q = q.lte("occurred_on", f.to);

  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const offset = Math.max(f.offset ?? 0, 0);
  const { data, error, count } = await q
    .order("occurred_on", { ascending: false })
    .order("amount", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw new Error(error.message);
  return { rows: data ?? [], total: count ?? 0 };
}

/** One finding with its act log — the slide-over's whole payload in one round trip. */
export async function readException(
  admin: SupabaseClient,
  orgId: string,
  id: string,
): Promise<{ exception: unknown; events: unknown[] } | null> {
  const { data } = await admin.from("fuel_exceptions").select(COLS).eq("org_id", orgId).eq("id", id).maybeSingle();
  if (!data) return null;
  const { data: events } = await admin
    .from("fuel_exception_events")
    .select("id, kind, from_status, to_status, note, actor_id, created_at")
    .eq("org_id", orgId)
    .eq("exception_id", id)
    .order("created_at", { ascending: false });
  return { exception: data, events: events ?? [] };
}

/**
 * ── E3: identified / claimed / recovered, and never one number ───────────────────────────────────
 * The figure that renews a contract is not "we found $14,200" — it is "we recovered $14,200". Those
 * are different, and a product that reports only the first can never prove itself.
 *
 * Grouped by `amount_kind` as well, because the four kinds of money must not be added: overbilled is
 * recoverable, unbilled may still be owed, and unrecorded is unexplained (D-FX5).
 */
export async function exceptionTotals(
  admin: SupabaseClient,
  orgId: string,
  window: { from?: string | null; to?: string | null } = {},
): Promise<Record<string, unknown>> {
  let q = admin.from("fuel_exceptions").select("status, amount_kind, amount, credited_amount").eq("org_id", orgId);
  if (window.from) q = q.gte("occurred_on", window.from);
  if (window.to) q = q.lte("occurred_on", window.to);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<{ status: string; amount_kind: string; amount: string | number; credited_amount: string | number | null }>;
  const byKind: Record<string, { identified: number; lines: number }> = {};
  let identified = 0, claimed = 0, recovered = 0, openLines = 0;
  for (const r of rows) {
    const amt = Number(r.amount) || 0;
    identified += amt;
    byKind[r.amount_kind] ??= { identified: 0, lines: 0 };
    byKind[r.amount_kind]!.identified += amt;
    byKind[r.amount_kind]!.lines += 1;
    if (r.status === "disputed" || r.status === "credited") claimed += amt;
    if (r.status === "credited") recovered += Number(r.credited_amount ?? 0) || 0;
    if ((FUEL_EXCEPTION_OPEN_STATUSES as readonly string[]).includes(r.status)) openLines += 1;
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    identified: r2(identified),
    claimed: r2(claimed),
    recovered: r2(recovered),
    lines: rows.length,
    openLines,
    byKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, { ...v, identified: r2(v.identified) }])),
  };
}

export interface LifecycleMove {
  status?: FuelExceptionStatus;
  assignedTo?: string | null;
  note?: string | null;
  creditedAmount?: number | null;
  creditedOn?: string | null;
}

/**
 * Move a finding, and record who moved it in the same breath.
 *
 * The act log is append-only and this is the only writer, so the pairing is what makes "who closed a
 * $9,000 dispute and when" answerable at all. A move that changes nothing still writes a note event
 * when a note was given — a comment is an act.
 */
export async function moveException(
  admin: SupabaseClient,
  orgId: string,
  id: string,
  actorId: string | null,
  move: LifecycleMove,
): Promise<{ ok: boolean; error?: string; exception?: unknown }> {
  const { data: current } = await admin
    .from("fuel_exceptions").select("id, status").eq("org_id", orgId).eq("id", id).maybeSingle();
  if (!current) return { ok: false, error: "No such exception." };
  const from = (current as { status: FuelExceptionStatus }).status;

  // A credit is only meaningful on a credited finding, and the CHECK constraint agrees — refusing here
  // gives the caller a sentence instead of a constraint violation.
  if (move.creditedAmount != null && move.status !== "credited") {
    return { ok: false, error: "A credited amount can only be recorded when the finding is marked credited." };
  }

  const patch: Record<string, unknown> = {};
  if (move.status && move.status !== from) {
    patch.status = move.status;
    // Resolution is stamped by the move that resolves, so a reopened finding does not keep a stale one.
    const closing = move.status === "credited" || move.status === "dismissed";
    patch.resolved_at = closing ? new Date().toISOString() : null;
    patch.resolved_by = closing ? actorId : null;
  }
  if (move.assignedTo !== undefined) patch.assigned_to = move.assignedTo;
  if (move.note !== undefined && move.note !== null) patch.resolution_note = move.note;
  if (move.status === "credited") {
    patch.credited_amount = move.creditedAmount ?? null;
    patch.credited_on = move.creditedOn ?? new Date().toISOString().slice(0, 10);
  }

  if (Object.keys(patch).length > 0) {
    // An explicit UPDATE, never a partial `.upsert()` — Postgres checks NOT NULL before conflict
    // arbitration and a partial payload fails on columns it never meant to write (`lint:upserts`).
    const { error } = await admin.from("fuel_exceptions").update(patch).eq("org_id", orgId).eq("id", id);
    if (error) return { ok: false, error: error.message };
  }

  const events: Record<string, unknown>[] = [];
  if (patch.status) {
    events.push({
      org_id: orgId, exception_id: id, actor_id: actorId,
      kind: move.status === "credited" ? "credited" : "status_changed",
      from_status: from, to_status: move.status, note: move.note ?? null,
    });
  } else if (move.note) {
    events.push({ org_id: orgId, exception_id: id, actor_id: actorId, kind: "note", note: move.note });
  }
  if (move.assignedTo !== undefined) {
    events.push({ org_id: orgId, exception_id: id, actor_id: actorId, kind: "assigned", note: move.assignedTo ?? "unassigned" });
  }
  if (events.length) await admin.from("fuel_exception_events").insert(events);

  const { data: after } = await admin.from("fuel_exceptions").select(COLS).eq("org_id", orgId).eq("id", id).maybeSingle();
  return { ok: true, exception: after };
}
