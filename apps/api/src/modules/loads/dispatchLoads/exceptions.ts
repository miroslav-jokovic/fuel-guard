import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EXCEPTION_LABELS,
  type DispatchException,
  type ExceptionAction,
  type ExceptionKind,
} from "@silvicom/shared";
import { fetchAllPaged, fetchAllPagedIn } from "../../../lib/paging.js";
import { dispatchesByLoad } from "../dispatchToDriver.js";

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
 * ── THREE SOURCES ADDED BY T1 N-9 (M-A) ──────────────────────────────────────────────────────────
 *   · late_evidence — a driver event 0661 flagged `late_evidence: true`: work that landed after the
 *     office re-sent the load, or on a stop McLeod removed. The photos were KEPT and nothing on the
 *     load moved (D-MK20); somebody has to decide what the evidence means.
 *   · stop_mirror_refused — McLeod's stops could not be applied to the load (0660). The mirror writes
 *     one a day while it keeps failing and closes the newest when a sweep applies cleanly, so a load
 *     shows ONE: its newest refusal, and only while no clean apply is later than it.
 *   · dispatch_not_visible — DERIVED, not an event: an open McLeod load whose current dispatch reaches
 *     nobody's app (`reachable`, dispatchFacts.ts). Its synthetic id is `dispatch_not_visible:<load>`,
 *     the key `resolveException` writes for a kind without an event, and a resolution counts only if it
 *     is later than the dispatch — sending the load again is a new question.
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

const EVENT_KINDS = ["declined", "equipment_mismatch", "amended", "stop_mirror_refused"] as const;

/** Bound the scan. An exception older than this is history, not a queue item. */
const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

const ACTION_FOR: Record<ExceptionKind, ExceptionAction> = {
  declined: "reassign",
  equipment_mismatch: "adopt_equipment",
  amended: "review_diff",
  auto_timeout: "acknowledge",
  late_evidence: "acknowledge",
  dispatch_not_visible: "acknowledge",
  stop_mirror_refused: "acknowledge",
};

interface EventRow {
  id: string;
  load_id: string;
  kind: string;
  payload: Record<string, unknown>;
  occurred_at: string;
}

interface ResolvedRow {
  load_id: string;
  payload: Record<string, unknown>;
  occurred_at: string;
}

type Named = { full_name?: string } | { full_name?: string }[] | null;
const nameOf = (j: Named): string | null => (Array.isArray(j) ? j[0]?.full_name : j?.full_name) ?? null;

function summarize(kind: ExceptionKind, ref: string | null, payload: Record<string, unknown>, driver: string | null): string {
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
    case "late_evidence": {
      const who = driver ?? "A driver";
      const stop = typeof payload.seq === "number" ? ` stop ${payload.seq} of` : "";
      return payload.late_reason === "removed_in_mcleod"
        ? `${who} sent work for${stop} ${load}, a stop McLeod has removed. It was kept, not applied.`
        : `${who} sent work for${stop} ${load} after it was sent to somebody else. It was kept, not applied.`;
    }
    case "dispatch_not_visible":
      return payload.reason === "uncovered_in_mcleod"
        ? `${load} was sent, but McLeod has it uncovered, so nobody sees it in the app.`
        : `${load} was sent to ${driver ?? "a driver"}, who has no app login, so nobody sees it in the app.`;
    case "stop_mirror_refused":
      return `McLeod's stops for ${load} could not be applied; the driver sees the stops from before.`;
  }
}

/**
 * Every open exception in the org, newest first.
 *
 * Reads, none of them per-row: the candidate events, the late-evidence events, the resolutions, the
 * loads and drivers they name, the timed-out shifts, and (for `dispatch_not_visible`) the open McLeod
 * loads with their dispatches. A feed that N+1s is a feed nobody leaves open.
 */
export async function listExceptions(
  admin: SupabaseClient,
  orgId: string,
  now = new Date(),
): Promise<DispatchException[]> {
  const since = new Date(now.getTime() - LOOKBACK_MS).toISOString();

  const [eventsResult, late, resolvedResult, timeoutResult, notVisible] = await Promise.all([
    admin
      .from("load_events")
      .select("id, load_id, kind, payload, occurred_at")
      .eq("org_id", orgId)
      .in("kind", EVENT_KINDS)
      .gte("occurred_at", since)
      .order("occurred_at", { ascending: false }),
    fetchAllPaged<EventRow>((from, to) =>
      admin
        .from("load_events")
        .select("id, load_id, kind, payload, occurred_at")
        .eq("org_id", orgId)
        .eq("payload->>late_evidence", "true")
        .gte("occurred_at", since)
        .order("id")
        .range(from, to),
    ),
    admin
      .from("load_events")
      .select("load_id, payload, occurred_at")
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
    dispatchesNobodySees(admin, orgId),
  ]);

  const resolutions = latestResolutions((resolvedResult.data ?? []) as unknown as ResolvedRow[]);
  const events = openEvents([...((eventsResult.data ?? []) as unknown as EventRow[]), ...late], resolutions);

  // One lookup for the refs and driver names the events need, keyed by the loads they point at.
  const loadIds = [...new Set([...events.map((e) => e.load_id), ...notVisible.map((d) => d.loadId)])];
  const refs = new Map<string, { ref: string | null; driver: string | null }>();
  const loadRows = await fetchAllPagedIn<{ id: string; ref: string | null; drivers: Named }>(loadIds, (chunk) => (from, to) =>
    admin.from("loads").select("id, ref, drivers(full_name)").eq("org_id", orgId).in("id", chunk).order("id").range(from, to),
  );
  for (const row of loadRows) refs.set(row.id, { ref: row.ref, driver: nameOf(row.drivers) });
  const lateDrivers = await driverNames(admin, orgId, late);

  const out: DispatchException[] = events.map((e) => {
    const kind = e.kind === "stop_mirror_refused" || EVENT_KINDS.includes(e.kind as never) ? (e.kind as ExceptionKind) : "late_evidence";
    const meta = refs.get(e.load_id);
    const driver = kind === "late_evidence" ? (lateDrivers.get(String(e.payload?.driver_id)) ?? null) : (meta?.driver ?? null);
    return {
      id: e.id,
      kind,
      load_id: e.load_id,
      load_ref: meta?.ref ?? null,
      driver_name: driver,
      summary: summarize(kind, meta?.ref ?? null, e.payload ?? {}, driver),
      detail: e.payload ?? {},
      action: ACTION_FOR[kind],
      occurred_at: e.occurred_at,
    };
  });

  for (const d of notVisible) {
    const syntheticId = `dispatch_not_visible:${d.loadId}`;
    const resolvedAt = resolutions.get(syntheticId);
    if (resolvedAt && resolvedAt >= d.sentAt) continue;
    const meta = refs.get(d.loadId);
    out.push({
      id: syntheticId,
      kind: "dispatch_not_visible",
      load_id: d.loadId,
      load_ref: meta?.ref ?? null,
      driver_name: d.driverName,
      summary: summarize("dispatch_not_visible", meta?.ref ?? null, { reason: d.reason }, d.driverName),
      detail: { dispatch_id: d.dispatchId, reason: d.reason },
      action: ACTION_FOR.dispatch_not_visible,
      occurred_at: d.sentAt,
    });
  }

  // The derived source. It has no event to point at, so its id is synthetic and stable — the same
  // timed-out shift must not produce a new row on every poll.
  for (const row of (timeoutResult.data ?? []) as unknown as { id: string; ended_at: string; drivers: Named }[]) {
    const syntheticId = `auto_timeout:${row.id}`;
    if (resolutions.has(syntheticId)) continue;
    const name = nameOf(row.drivers);
    out.push({
      id: syntheticId,
      kind: "auto_timeout",
      load_id: null,
      load_ref: null,
      driver_name: name,
      summary: `${name ?? "A driver"}'s shift was auto-closed after running past the organisation's limit.`,
      detail: { session_id: row.id, ended_at: row.ended_at },
      action: ACTION_FOR.auto_timeout,
      occurred_at: row.ended_at,
    });
  }

  return out.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
}

/** `resolves` key → the newest resolution's time. A mirror's clean apply also lands per load. */
function latestResolutions(rows: ResolvedRow[]): Map<string, string> {
  const out = new Map<string, string>();
  const put = (key: string, at: string) => {
    const prev = out.get(key);
    if (!prev || at > prev) out.set(key, at);
  };
  for (const r of rows) {
    if (typeof r.payload?.resolves === "string") put(r.payload.resolves, r.occurred_at);
    if (r.payload?.kind === "stop_mirror_refused" && r.payload?.by === "mirror") put(`stop_mirror_refused:${r.load_id}`, r.occurred_at);
  }
  return out;
}

/**
 * The events still open: not resolved by id, and for a load's stop refusals only the newest, only while
 * no clean apply is later than it (0660 closes the newest open refusal; the older ones it leaves are
 * the same fact repeated, not separate problems).
 */
function openEvents(events: EventRow[], resolutions: Map<string, string>): EventRow[] {
  const byId = new Map(events.map((e) => [e.id, e])); // a late stop event is never also a candidate kind
  const newestRefusal = new Map<string, EventRow>();
  const out: EventRow[] = [];
  for (const e of byId.values()) {
    if (resolutions.has(e.id)) continue;
    if (e.kind !== "stop_mirror_refused") {
      out.push(e);
      continue;
    }
    const prev = newestRefusal.get(e.load_id);
    if (!prev || e.occurred_at > prev.occurred_at) newestRefusal.set(e.load_id, e);
  }
  for (const e of newestRefusal.values()) {
    const cleanAt = resolutions.get(`stop_mirror_refused:${e.load_id}`);
    if (!cleanAt || cleanAt < e.occurred_at) out.push(e);
  }
  return out;
}

/** The drivers late evidence names, by `payload.driver_id` (0661 stamps it on every driver event). */
async function driverNames(admin: SupabaseClient, orgId: string, events: EventRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(events.map((e) => e.payload?.driver_id).filter((d): d is string => typeof d === "string"))];
  const rows = await fetchAllPagedIn<{ id: string; full_name: string }>(ids, (chunk) => (from, to) =>
    admin.from("drivers").select("id, full_name").eq("org_id", orgId).in("id", chunk).order("id").range(from, to),
  );
  return new Map(rows.map((r) => [r.id, r.full_name]));
}

/**
 * Open McLeod loads whose current dispatch reaches nobody's app — derived from `reachable`, the same
 * fact the load page shows. A closed load is not an exception (it is done), so `closed` never appears.
 */
async function dispatchesNobodySees(
  admin: SupabaseClient,
  orgId: string,
): Promise<{ loadId: string; dispatchId: string; sentAt: string; driverName: string | null; reason: string }[]> {
  const open = await fetchAllPaged<{ id: string }>((from, to) =>
    admin
      .from("loads")
      .select("id")
      .eq("org_id", orgId)
      .eq("source", "tms")
      .not("status", "in", "(delivered,canceled)")
      .is("external_closed_at", null)
      .order("id")
      .range(from, to),
  );
  const dispatches = await dispatchesByLoad(admin, orgId, open.map((l) => l.id));
  const out = [];
  for (const [loadId, list] of dispatches) {
    const current = list[0];
    if (!current || current.reachable.ok || current.reachable.reason === "closed") continue;
    out.push({ loadId, dispatchId: current.id, sentAt: current.sentAt, driverName: current.driverName, reason: current.reachable.reason });
  }
  return out;
}

export { EXCEPTION_LABELS };
