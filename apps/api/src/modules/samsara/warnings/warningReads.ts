/**
 * Reads of `samsara_warnings` for the warning desk (WARNING-DESK-PLAN D-WD6). The table is this
 * collector's (D-ARC3); the desk — the `followups` harness, through `orchestration/warningDesk.ts` and
 * its own routes — reads it only through these functions. Every query is org-scoped: the API reads with
 * the service role, which bypasses RLS.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { warningSubjectId, type DeskWarning, type WarningSubject } from "@silvicom/shared";

export interface StoredWarning extends DeskWarning {
  id: string;
  source: string;
  subjectId: string | null;
  samsaraUrl: string | null;
  detail: Record<string, unknown>;
  updatedAt: string;
}

const COLUMNS =
  "id, source, kind, subject_kind, vehicle_samsara_id, trailer_samsara_id, driver_samsara_id, unit_name, driver_name, label, happened_at, ended_at, still_active, samsara_url, detail, updated_at";
const PAGE = 1000;

function toWarning(r: Record<string, unknown>): StoredWarning {
  const w = {
    id: String(r.id),
    source: String(r.source),
    kind: String(r.kind),
    subjectKind: r.subject_kind as WarningSubject,
    vehicleSamsaraId: (r.vehicle_samsara_id as string | null) ?? null,
    trailerSamsaraId: (r.trailer_samsara_id as string | null) ?? null,
    driverSamsaraId: (r.driver_samsara_id as string | null) ?? null,
    unitName: (r.unit_name as string | null) ?? null,
    driverName: (r.driver_name as string | null) ?? null,
    label: String(r.label),
    happenedAt: new Date(Date.parse(String(r.happened_at))).toISOString(),
    endedAt: r.ended_at ? new Date(Date.parse(String(r.ended_at))).toISOString() : null,
    stillActive: r.still_active === true,
    samsaraUrl: (r.samsara_url as string | null) ?? null,
    detail: (r.detail as Record<string, unknown> | null) ?? {},
    updatedAt: String(r.updated_at),
  };
  return { ...w, subjectId: warningSubjectId(w) };
}

// Supabase's query builder type is deep; the paging helper takes the built query as a thunk.
type RangeQuery = { range: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> };

async function allPages(build: () => RangeQuery, what: string): Promise<StoredWarning[]> {
  const out: StoredWarning[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(`samsara_warnings ${what}: ${error.message}`);
    const rows = (data ?? []) as Record<string, unknown>[];
    out.push(...rows.map(toWarning));
    if (rows.length < PAGE) return out;
  }
}

/** Warnings written or refreshed since `sinceIso` — what a tick has to re-evaluate. */
export function listWarningsUpdatedSince(admin: SupabaseClient, orgId: string, sinceIso: string): Promise<StoredWarning[]> {
  return allPages(
    () => admin.from("samsara_warnings").select(COLUMNS).eq("org_id", orgId).gte("updated_at", sinceIso).order("id") as unknown as RangeQuery,
    "updated",
  );
}

/** Every warning still active for the given kinds — open defects and lamps that are on, however old. */
export function listActiveWarnings(admin: SupabaseClient, orgId: string, kinds: readonly string[]): Promise<StoredWarning[]> {
  if (kinds.length === 0) return Promise.resolve([]);
  return allPages(
    () =>
      admin.from("samsara_warnings").select(COLUMNS).eq("org_id", orgId).eq("still_active", true).in("kind", [...kinds]).order("id") as unknown as RangeQuery,
    "active",
  );
}

export interface SubjectWarningQuery {
  kind: string;
  subjectKind: WarningSubject;
  subjectIds: readonly string[];
  /** Warnings that happened since this time, plus any still active whenever they began. */
  sinceIso: string;
}

const SUBJECT_COLUMN: Record<WarningSubject, string> = {
  truck: "vehicle_samsara_id",
  trailer: "trailer_samsara_id",
  driver: "driver_samsara_id",
};

/** One kind's warnings for a set of trucks, trailers or drivers. */
export async function listSubjectWarnings(admin: SupabaseClient, orgId: string, q: SubjectWarningQuery): Promise<StoredWarning[]> {
  if (q.subjectIds.length === 0) return [];
  const out: StoredWarning[] = [];
  for (let i = 0; i < q.subjectIds.length; i += 200) {
    const ids = q.subjectIds.slice(i, i + 200);
    out.push(
      ...(await allPages(
        () =>
          admin
            .from("samsara_warnings")
            .select(COLUMNS)
            .eq("org_id", orgId)
            .eq("kind", q.kind)
            .eq("subject_kind", q.subjectKind)
            .in(SUBJECT_COLUMN[q.subjectKind], [...ids])
            .or(`happened_at.gte.${q.sinceIso},still_active.eq.true`)
            .order("id") as unknown as RangeQuery,
        "subject",
      )),
    );
  }
  return out;
}
