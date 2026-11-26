/**
 * Warnings → follow-ups (WARNING-DESK-PLAN WD3, D-WD6). Runs after every collector pass.
 *
 * ── WHAT ONE PASS DOES ───────────────────────────────────────────────────────────────────────────
 * 1. Finds every (rule, unit-or-driver) a new or refreshed warning touched since the last pass, plus
 *    every state warning still active (an open defect or a lamp that is on counts once it is OLD
 *    enough, and growing old changes no row).
 * 2. If that problem already has an open follow-up, refreshes its count, last time, how many warnings
 *    are still active, and its severity — and never its status or version, so a person's click is not
 *    refused because a warning arrived meanwhile (0653 §4).
 * 3. Otherwise asks `decideOpen` — the Nth time inside the rule's window, counting again from the last
 *    closed follow-up — and opens one.
 *
 * Idempotent: running the same pass twice changes nothing the second time. The one-open-per-problem
 * promise is the partial unique index (0653), so two passes racing cannot open the same problem twice;
 * the loser's insert is a 23505 and is dropped.
 *
 * Reads warnings only through the collector's exported reads, which the orchestrator passes in
 * (docs/ARCHITECTURE.md D-ARC3) — this module never names `samsara_warnings`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  decideOpen,
  higherSeverity,
  warningCounts,
  warningSeverity,
  warningSubjectName,
  type DeskWarning,
  type FollowUpRule,
  type FollowUpSeverity,
  type WarningSubject,
} from "@silvicom/shared";

export type EvaluatedWarning = DeskWarning & { subjectId: string | null };

export interface WarningReaders {
  updatedSince(sinceIso: string): Promise<EvaluatedWarning[]>;
  active(kinds: readonly string[]): Promise<EvaluatedWarning[]>;
  subject(q: { kind: string; subjectKind: WarningSubject; subjectIds: readonly string[]; sinceIso: string }): Promise<EvaluatedWarning[]>;
}

export interface EvaluateResult {
  problems: number;
  opened: number;
  refreshed: number;
  /** Ids of follow-ups opened at urgent severity this pass — the bell's list (D-WD14). */
  urgentOpened: string[];
}

interface OpenFollowUp {
  id: string;
  rule_key: string;
  subject_kind: WarningSubject;
  subject_samsara_id: string;
  severity: FollowUpSeverity;
  warning_count: number;
  active_count: number;
  first_at: string;
  last_at: string;
  subject_name: string | null;
  driver_samsara_id: string | null;
  driver_name: string | null;
}

const DAY = 86_400_000;
const problemKey = (rule: string, kind: WarningSubject, id: string) => `${rule}\u0000${kind}\u0000${id}`;
const iso = (v: string) => new Date(Date.parse(v)).toISOString();

async function openFollowUps(admin: SupabaseClient, orgId: string): Promise<Map<string, OpenFollowUp>> {
  const { data, error } = await admin
    .from("follow_ups")
    .select("id, rule_key, subject_kind, subject_samsara_id, severity, warning_count, active_count, first_at, last_at, subject_name, driver_samsara_id, driver_name")
    .eq("org_id", orgId)
    .neq("status", "closed");
  if (error) throw new Error(`follow_ups open: ${error.message}`);
  const out = new Map<string, OpenFollowUp>();
  for (const r of (data ?? []) as OpenFollowUp[]) {
    out.set(problemKey(r.rule_key, r.subject_kind, r.subject_samsara_id), { ...r, first_at: iso(r.first_at), last_at: iso(r.last_at) });
  }
  return out;
}

/** When each problem's last follow-up was closed — counting starts again after it. */
async function lastClosed(admin: SupabaseClient, orgId: string, sinceIso: string): Promise<Map<string, string>> {
  const { data, error } = await admin
    .from("follow_ups")
    .select("rule_key, subject_kind, subject_samsara_id, closed_at")
    .eq("org_id", orgId)
    .eq("status", "closed")
    .gte("closed_at", sinceIso);
  if (error) throw new Error(`follow_ups closed: ${error.message}`);
  const out = new Map<string, string>();
  for (const r of (data ?? []) as { rule_key: string; subject_kind: WarningSubject; subject_samsara_id: string; closed_at: string }[]) {
    const k = problemKey(r.rule_key, r.subject_kind, r.subject_samsara_id);
    const prev = out.get(k);
    if (!prev || Date.parse(r.closed_at) > Date.parse(prev)) out.set(k, iso(r.closed_at));
  }
  return out;
}

/** The newest warning that names a driver, for "who to call" (the warning's own word, D-WD15). */
function latestDriver(ws: readonly EvaluatedWarning[]): { id: string | null; name: string | null } {
  let best: EvaluatedWarning | null = null;
  for (const w of ws) if (w.driverSamsaraId && (!best || Date.parse(w.happenedAt) > Date.parse(best.happenedAt))) best = w;
  return { id: best?.driverSamsaraId ?? null, name: best?.driverName ?? null };
}

function latestName(ws: readonly EvaluatedWarning[]): string | null {
  let name: string | null = null;
  let at = -Infinity;
  for (const w of ws) {
    const n = warningSubjectName(w);
    if (n && Date.parse(w.happenedAt) >= at) {
      name = n;
      at = Date.parse(w.happenedAt);
    }
  }
  return name;
}

export async function evaluateFollowUps(
  admin: SupabaseClient,
  orgId: string,
  opts: { now: Date; rules: readonly FollowUpRule[]; sinceIso: string; readers: WarningReaders },
): Promise<EvaluateResult> {
  const nowMs = opts.now.getTime();
  const rules = new Map(opts.rules.map((r) => [r.key, r]));
  const stateKinds = opts.rules.filter((r) => r.enabled && r.minActiveHours > 0).map((r) => r.key);
  const touched = [...(await opts.readers.updatedSince(opts.sinceIso)), ...(await opts.readers.active(stateKinds))];

  // The problems to look at: (rule, subject kind) → subject ids.
  const byRule = new Map<string, { kind: string; subjectKind: WarningSubject; ids: Set<string> }>();
  for (const w of touched) {
    if (!w.subjectId || !rules.has(w.kind)) continue;
    const k = `${w.kind}\u0000${w.subjectKind}`;
    const entry = byRule.get(k) ?? { kind: w.kind, subjectKind: w.subjectKind, ids: new Set<string>() };
    entry.ids.add(w.subjectId);
    byRule.set(k, entry);
  }

  const open = await openFollowUps(admin, orgId);
  const longestWindow = Math.max(1, ...opts.rules.map((r) => r.windowDays));
  const closed = await lastClosed(admin, orgId, new Date(nowMs - (longestWindow + 1) * DAY).toISOString());
  const result: EvaluateResult = { problems: 0, opened: 0, refreshed: 0, urgentOpened: [] };

  for (const { kind, subjectKind, ids } of byRule.values()) {
    const rule = rules.get(kind);
    if (!rule) continue;
    let sinceMs = nowMs - rule.windowDays * DAY;
    for (const id of ids) {
      const f = open.get(problemKey(kind, subjectKind, id));
      if (f) sinceMs = Math.min(sinceMs, Date.parse(f.first_at));
    }
    const warnings = await opts.readers.subject({ kind, subjectKind, subjectIds: [...ids], sinceIso: new Date(sinceMs).toISOString() });
    const perSubject = new Map<string, EvaluatedWarning[]>();
    for (const w of warnings) {
      if (!w.subjectId) continue;
      const list = perSubject.get(w.subjectId) ?? [];
      list.push(w);
      perSubject.set(w.subjectId, list);
    }
    for (const id of ids) {
      result.problems += 1;
      const ws = perSubject.get(id) ?? [];
      const key = problemKey(kind, subjectKind, id);
      const existing = open.get(key);
      if (existing) {
        if (await refresh(admin, orgId, existing, rule, ws, nowMs)) result.refreshed += 1;
        continue;
      }
      const decision = decideOpen(rule, ws, closed.get(key) ?? null, nowMs);
      if (!decision.open) continue;
      const inWindow = ws.filter((w) => Date.parse(w.happenedAt) >= Date.parse(decision.firstAt));
      const severity = warningSeverity(rule, inWindow, nowMs);
      const driver = latestDriver(inWindow);
      const { data, error } = await admin
        .from("follow_ups")
        .insert({
          org_id: orgId,
          rule_key: kind,
          category: rule.category,
          severity,
          subject_kind: subjectKind,
          subject_samsara_id: id,
          subject_name: latestName(inWindow),
          driver_samsara_id: driver.id,
          driver_name: driver.name,
          status: "new",
          warning_count: decision.count,
          active_count: decision.activeCount,
          first_at: decision.firstAt,
          last_at: decision.lastAt,
        })
        .select("id")
        .single();
      if (error) {
        if ((error as { code?: string }).code === "23505") continue; // another pass opened it first
        throw new Error(`follow_ups open: ${error.message}`);
      }
      result.opened += 1;
      if (severity === "urgent") result.urgentOpened.push(String((data as { id: string }).id));
    }
  }
  return result;
}

/** Refresh an open follow-up from its warnings. Writes only when something changed. */
async function refresh(
  admin: SupabaseClient,
  orgId: string,
  f: OpenFollowUp,
  rule: FollowUpRule,
  ws: readonly EvaluatedWarning[],
  nowMs: number,
): Promise<boolean> {
  const counting = ws.filter((w) => Date.parse(w.happenedAt) >= Date.parse(f.first_at) && warningCounts(rule, w, nowMs));
  if (counting.length === 0) return false;
  const lastMs = Math.max(Date.parse(f.last_at), ...counting.map((w) => Date.parse(w.happenedAt)));
  const driver = latestDriver(counting);
  const next = {
    warning_count: Math.max(f.warning_count, counting.length),
    active_count: counting.filter((w) => w.stillActive).length,
    last_at: new Date(lastMs).toISOString(),
    severity: higherSeverity(f.severity, warningSeverity(rule, counting, nowMs)),
    subject_name: latestName(counting) ?? f.subject_name,
    driver_samsara_id: driver.id ?? f.driver_samsara_id,
    driver_name: driver.name ?? f.driver_name,
  };
  const same =
    next.warning_count === f.warning_count &&
    next.active_count === f.active_count &&
    next.last_at === f.last_at &&
    next.severity === f.severity &&
    next.subject_name === f.subject_name &&
    next.driver_samsara_id === f.driver_samsara_id &&
    next.driver_name === f.driver_name;
  if (same) return false;
  const { error } = await admin
    .from("follow_ups")
    .update({ ...next, updated_at: new Date(nowMs).toISOString() })
    .eq("id", f.id)
    .eq("org_id", orgId)
    .neq("status", "closed");
  if (error) throw new Error(`follow_ups refresh: ${error.message}`);
  return true;
}
