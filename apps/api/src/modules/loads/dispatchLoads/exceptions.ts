import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EXCEPTION_LABELS,
  type DispatchException,
  type ExceptionAction,
  type ExceptionKind,
} from "@silvicom/shared";

/**
 * The exceptions feed (L2 / D-L2) — the things that go wrong on a load and need a person.
 *
 * ── TWO SOURCES LEFT IN LR6 (LOADS-MIRROR-PLAN.md) ───────────────────────────────────────────────
 * `stale_approval` was derived from a load sitting in `pending_approval` for a day. Every McLeod `A`
 * (uncovered) movement projects to that status and nobody approves anything any more (D-LMR5), so
 * it would have flagged all 47 of them as "waiting for approval" forever. `load_changed` was an
 * exception only because the office's edit of a released load wrote it; that edit is gone, and the
 * projection (`mirrorLoads.ts`) writes the same kind as plain status history, which is not something
 * anybody needs to acknowledge. `amended` stays while its writer does: the old TMS load ingest, whose
 * route LR8 removes with `load_external_payloads`.
 *
 * WHY IT IS EVENT-DRIVEN. The client-side `isException()` it replaces derived from `loads` columns,
 * so it could only ever see two of the five: a decline and an aging approval. Equipment mismatches,
 * TMS amendments and post-release changes exist ONLY as events, so they were invisible on a board
 * whose whole purpose is to show what needs attention. Reading the event log also makes the feed
 * complete by construction — a new event kind appears rather than being silently excluded by a filter
 * nobody widened.
 *
 * WHY RESOLUTION IS ALSO AN EVENT. `load_events` is append-only, deliberately: it is the record that
 * answers "who moved this load and when" to an auditor. So an exception is open until a later
 * `exception_resolved` event names it, rather than being closed by mutating history.
 */

const EVENT_KINDS = ["declined", "equipment_mismatch", "amended"] as const;

/** Bound the scan. An exception older than this is history, not a queue item. */
const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

const ACTION_FOR: Record<ExceptionKind, ExceptionAction> = {
  declined: "reassign",
  equipment_mismatch: "adopt_equipment",
  amended: "review_diff",
  auto_timeout: "acknowledge",
};

interface EventRow {
  id: string;
  load_id: string;
  kind: string;
  payload: Record<string, unknown>;
  occurred_at: string;
}

function summarize(kind: ExceptionKind, ref: string | null, payload: Record<string, unknown>): string {
  const load = ref ?? "This load";
  switch (kind) {
    case "declined":
      return `${load} was declined${payload.reason ? ` — “${String(payload.reason)}”` : ""}.`;
    case "equipment_mismatch":
      return `${load} was accepted in different equipment from the one dispatch planned.`;
    case "amended":
      return `${load} was amended by the TMS: ${(payload.changed as string[] | undefined)?.join(", ") ?? "fields changed"}.`;
    case "auto_timeout":
      return "A shift was auto-closed after running past the organisation's limit.";
  }
}

/**
 * Every open exception in the org, newest first.
 *
 * Four reads, none of them per-row: the candidate events, the `exception_resolved` events that close
 * them, the loads they belong to, and the timed-out shifts. A feed that N+1s is a feed nobody
 * leaves open.
 */
export async function listExceptions(
  admin: SupabaseClient,
  orgId: string,
  now = new Date(),
): Promise<DispatchException[]> {
  const since = new Date(now.getTime() - LOOKBACK_MS).toISOString();

  const [eventsResult, resolvedResult, timeoutResult] = await Promise.all([
    admin
      .from("load_events")
      .select("id, load_id, kind, payload, occurred_at")
      .eq("org_id", orgId)
      .in("kind", EVENT_KINDS)
      .gte("occurred_at", since)
      .order("occurred_at", { ascending: false }),
    admin
      .from("load_events")
      .select("payload")
      .eq("org_id", orgId)
      .eq("kind", "exception_resolved")
      .gte("occurred_at", since),
    admin
      .from("driver_duty_sessions")
      .select("id, ended_at, drivers(full_name)")
      .eq("org_id", orgId)
      .eq("ended_reason", "auto_timeout")
      .gte("ended_at", since)
      .order("ended_at", { ascending: false }),
  ]);

  const events = (eventsResult.data ?? []) as unknown as EventRow[];
  const resolvedIds = new Set(
    ((resolvedResult.data ?? []) as unknown as { payload: Record<string, unknown> }[])
      .map((r) => (typeof r.payload?.resolves === "string" ? r.payload.resolves : null))
      .filter((id): id is string => id !== null),
  );

  // One lookup for the refs and driver names the events need, keyed by the loads they point at.
  const loadIds = [...new Set(events.map((e) => e.load_id))];
  const refs = new Map<string, { ref: string | null; driver: string | null }>();
  if (loadIds.length > 0) {
    const { data } = await admin
      .from("loads")
      .select("id, ref, drivers(full_name)")
      .eq("org_id", orgId)
      .in("id", loadIds);
    for (const row of (data ?? []) as unknown as { id: string; ref: string | null; drivers: { full_name?: string } | { full_name?: string }[] | null }[]) {
      const join = Array.isArray(row.drivers) ? row.drivers[0] : row.drivers;
      refs.set(row.id, { ref: row.ref, driver: join?.full_name ?? null });
    }
  }

  const out: DispatchException[] = events
    .filter((e) => !resolvedIds.has(e.id))
    .map((e) => {
      const kind = e.kind as ExceptionKind;
      const meta = refs.get(e.load_id);
      return {
        id: e.id,
        kind,
        load_id: e.load_id,
        load_ref: meta?.ref ?? null,
        driver_name: meta?.driver ?? null,
        summary: summarize(kind, meta?.ref ?? null, e.payload ?? {}),
        detail: e.payload ?? {},
        action: ACTION_FOR[kind],
        occurred_at: e.occurred_at,
      };
    });

  // The derived source. It has no event to point at, so its id is synthetic and stable — the same
  // timed-out shift must not produce a new row on every poll.
  for (const row of (timeoutResult.data ?? []) as unknown as { id: string; ended_at: string; drivers: { full_name?: string } | { full_name?: string }[] | null }[]) {
    const syntheticId = `auto_timeout:${row.id}`;
    if (resolvedIds.has(syntheticId)) continue;
    const join = Array.isArray(row.drivers) ? row.drivers[0] : row.drivers;
    out.push({
      id: syntheticId,
      kind: "auto_timeout",
      load_id: null,
      load_ref: null,
      driver_name: join?.full_name ?? null,
      summary: `${join?.full_name ?? "A driver"}'s shift was auto-closed after running past the organisation's limit.`,
      detail: { session_id: row.id, ended_at: row.ended_at },
      action: ACTION_FOR.auto_timeout,
      occurred_at: row.ended_at,
    });
  }

  return out.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
}

export { EXCEPTION_LABELS };
