/**
 * What the toll GPS check reads and writes (TOLLS-PER-TRUCK-PLAN TL8a). Every query names the org: the
 * service role bypasses RLS, so nothing else would.
 *
 * ── LINES ARE READ ONCE A PROCESS, NOT ONCE A TICK ─────────────────────────────────────────────
 * The April–October statements are 28,294 lines (§1.3), 29 PostgREST pages. Read every tick on a
 * Micro database that already swaps, that is the GPS check's biggest cost, for rows that never change
 * (0633: a line is never changed or deleted). So the toll lines are cached per org, keyed by the set
 * of statements that are read and still kept: a new read, or a removal, is a new key and a fresh read.
 * The observed keys are cached the same way and grown by what this process writes; a unique-key refusal
 * (another writer, which the lane lease rules out) drops the cache rather than trusting it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged, fetchAllPagedIn, organizationTimezone, tollGps, tollTagKey, type TagAssignment, type TollProvider } from "@silvicom/shared";

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export interface PlazaRow {
  id: string;
  provider: TollProvider;
  role: tollGps.TollCheckpointRole;
  plaza_key: string;
  outcome: "placed" | "not_placed";
  known_count: number;
  lat: number | null;
  lon: number | null;
  time_zone: string | null;
  offset_s: number | null;
  offset_spread_s: number | null;
  created_at: string;
}

export interface ObservationRow {
  org_id: string;
  line_id: string;
  role: tollGps.TollCheckpointRole;
  plaza_id: string;
  outcome: "observed" | "clock_ambiguous" | "clock_skipped";
  at: string | null;
  half_window_s: number | null;
  nearby: tollGps.NearbyAsset[];
  reporting: string[];
}

const lineCache = new Map<string, { key: string; lines: tollGps.TollLineForGps[] }>();
const observedCache = new Map<string, Set<string>>();

export const observedKey = (lineId: string, role: string, plazaId: string) => `${lineId}|${role}|${plazaId}`;

/** For tests: forget what this process has read. */
export function forgetTollGpsCache(): void {
  lineCache.clear();
  observedCache.clear();
}

/** The org's clock, for reading a printed time well enough to ask the tag history (D-TL4's margin). */
export async function orgTimeZone(admin: SupabaseClient, orgId: string): Promise<string> {
  const { data, error } = await admin.from("organizations").select("operating_hours").eq("id", orgId).maybeSingle();
  if (error) throw new Error(error.message);
  return organizationTimezone((data as { operating_hours?: unknown } | null)?.operating_hours as Parameters<typeof organizationTimezone>[0]);
}

/** Every toll line of the org's read, kept statements (cached; see header). */
export async function tollLines(admin: SupabaseClient, orgId: string): Promise<tollGps.TollLineForGps[]> {
  const statements = await fetchAllPaged<{ id: string; provider: TollProvider }>((from, to) =>
    admin
      .from("toll_statements")
      .select("id, provider")
      .eq("org_id", orgId)
      .is("removed_at", null)
      .not("read_at", "is", null)
      .order("id", { ascending: true })
      .range(from, to) as unknown as Page<{ id: string; provider: TollProvider }>,
  );
  const key = statements.map((s) => s.id).join(",");
  const cached = lineCache.get(orgId);
  if (cached && cached.key === key) return cached.lines;
  const providerOf = new Map(statements.map((s) => [s.id, s.provider]));
  type Row = { id: string; statement_id: string; kind: string; tag_number: string | null; plate: string | null; agency: string | null; entry_plaza: string | null; entry_at: string | null; exit_plaza: string | null; exit_at: string | null; location: string | null };
  const rows = await fetchAllPagedIn<Row>(statements.map((s) => s.id), (part) => (from, to) =>
    admin
      .from("toll_statement_lines")
      .select("id, statement_id, kind, tag_number, plate, agency, entry_plaza, entry_at, exit_plaza, exit_at, location")
      .eq("org_id", orgId)
      .in("statement_id", part as string[])
      .eq("kind", "toll")
      .order("id", { ascending: true })
      .range(from, to) as unknown as Page<Row>,
  );
  const lines = rows.map((r) => ({
    id: r.id,
    provider: providerOf.get(r.statement_id)!,
    kind: r.kind,
    tagNumber: r.tag_number,
    plate: r.plate,
    agency: r.agency,
    entryPlaza: r.entry_plaza,
    // PostgREST renders `timestamp` as `2026-06-28T14:24:00`; the checkpoint reads either form.
    entryAt: r.entry_at,
    exitPlaza: r.exit_plaza,
    exitAt: r.exit_at,
    location: r.location,
  }));
  lineCache.set(orgId, { key, lines });
  return lines;
}

/** Tag key → its assignment history, and vehicle id → Samsara id, for the known tolls. */
export async function tagHistory(admin: SupabaseClient, orgId: string): Promise<{ historyOf: Map<string, TagAssignment[]>; samsaraOf: Map<string, string> }> {
  const tags = await fetchAllPaged<{ id: string; provider: TollProvider; tag_number: string }>((from, to) =>
    admin.from("toll_transponders").select("id, provider, tag_number").eq("org_id", orgId).order("id", { ascending: true }).range(from, to) as unknown as Page<{ id: string; provider: TollProvider; tag_number: string }>,
  );
  type A = { transponder_id: string; vehicle_id: string; valid_from: string; valid_to: string | null; voided_at: string | null };
  const assignments = await fetchAllPaged<A>((from, to) =>
    admin
      .from("toll_transponder_assignments")
      .select("transponder_id, vehicle_id, valid_from, valid_to, voided_at")
      .eq("org_id", orgId)
      .order("id", { ascending: true })
      .range(from, to) as unknown as Page<A>,
  );
  const vehicles = await fetchAllPaged<{ id: string; samsara_vehicle_id: string | null }>((from, to) =>
    admin.from("vehicles").select("id, samsara_vehicle_id").eq("org_id", orgId).order("id", { ascending: true }).range(from, to) as unknown as Page<{ id: string; samsara_vehicle_id: string | null }>,
  );
  const keyOf = new Map<string, string>();
  for (const t of tags) {
    const k = tollTagKey(t.provider, t.tag_number);
    if (k) keyOf.set(t.id, k);
  }
  const historyOf = new Map<string, TagAssignment[]>();
  for (const a of assignments) {
    const k = keyOf.get(a.transponder_id);
    if (!k) continue;
    const list = historyOf.get(k) ?? [];
    list.push({ vehicleId: a.vehicle_id, validFrom: a.valid_from, validTo: a.valid_to, voided: a.voided_at !== null });
    historyOf.set(k, list);
  }
  const samsaraOf = new Map<string, string>();
  for (const v of vehicles) if (v.samsara_vehicle_id) samsaraOf.set(v.id, v.samsara_vehicle_id);
  return { historyOf, samsaraOf };
}

/** The newest attempt per plaza key at the current engine version. */
export async function currentPlazas(admin: SupabaseClient, orgId: string): Promise<Map<string, PlazaRow>> {
  const rows = await fetchAllPaged<PlazaRow>((from, to) =>
    admin
      .from("toll_plazas")
      .select("id, provider, role, plaza_key, outcome, known_count, lat, lon, time_zone, offset_s, offset_spread_s, created_at")
      .eq("org_id", orgId)
      .eq("engine_version", tollGps.PLAZA_ENGINE_VERSION)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to) as unknown as Page<PlazaRow>,
  );
  const out = new Map<string, PlazaRow>();
  for (const r of rows) if (!out.has(r.plaza_key)) out.set(r.plaza_key, r);
  return out;
}

export async function insertPlaza(admin: SupabaseClient, row: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from("toll_plazas").insert(row);
  if (error) throw new Error(error.message);
}

/** The (line, role, plaza) keys already observed (cached; see header). */
export async function observedKeys(admin: SupabaseClient, orgId: string): Promise<Set<string>> {
  const cached = observedCache.get(orgId);
  if (cached) return cached;
  const rows = await fetchAllPaged<{ line_id: string; role: string; plaza_id: string }>((from, to) =>
    admin
      .from("toll_line_observations")
      .select("line_id, role, plaza_id")
      .eq("org_id", orgId)
      .order("id", { ascending: true })
      .range(from, to) as unknown as Page<{ line_id: string; role: string; plaza_id: string }>,
  );
  const set = new Set(rows.map((r) => observedKey(r.line_id, r.role, r.plaza_id)));
  observedCache.set(orgId, set);
  return set;
}

/** Write one window's observations together. A Samsara id that is not a number is refused, not dropped. */
export async function insertObservations(admin: SupabaseClient, orgId: string, rows: ObservationRow[]): Promise<void> {
  if (rows.length === 0) return;
  for (const r of rows) {
    const bad = [...r.reporting, ...r.nearby.map((n) => n.samsaraId)].find((id) => !/^\d{1,18}$/.test(id));
    if (bad !== undefined) throw new Error(`Samsara id ${JSON.stringify(bad)} is not a number; 0636 stores reporting ids as bigint`);
  }
  const { error } = await admin.from("toll_line_observations").insert(rows);
  if (error) {
    observedCache.delete(orgId);
    throw new Error(error.message);
  }
  const set = observedCache.get(orgId);
  for (const r of rows) set?.add(observedKey(r.line_id, r.role, r.plaza_id));
}
