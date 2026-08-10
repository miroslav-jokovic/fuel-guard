import type { SupabaseClient } from "@supabase/supabase-js";

const READ_PAGE = 1000;
const SEGMENT_PAD_MS = 72 * 3_600_000;

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

interface RawEngineDay {
  vehicle_id: string;
  day: string;
  drive_sec: number;
  idle_sec: number;
  off_sec: number;
  coverage_sec: number;
}

interface RawSession {
  vehicle_id: string;
  started_at: string;
  ended_at: string | null;
  idle_sec: number;
  mode: string;
}

interface RawEvent {
  vehicle_id: string | null;
  driver_id: string | null;
  started_at: string;
  duration_sec: number;
  air_temp_f: number | string | null;
}

interface RawSegment {
  driver_id: string;
  vehicle_id: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
}

interface RawAssignment {
  vehicle_samsara_id: string;
  driver_samsara_id: string;
  start_at: string;
  end_at: string | null;
}

export async function readAll<T>(
  table: string,
  page: (a: number, b: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += READ_PAGE) {
    const { data, error } = await page(offset, offset + READ_PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const batch = data ?? [];
    out.push(...batch);
    if (batch.length < READ_PAGE) break;
  }
  return out;
}

/** Read every raw input for the window (org-filtered — service role bypasses RLS). */
export async function readIdleRollupInputs(
  admin: SupabaseClient,
  orgId: string,
  w: { fromDate: string; fromIso: string; toIso: string },
) {
  const engineDays = await readAll<RawEngineDay>("vehicle_engine_days", (a, b) =>
    admin
      .from("vehicle_engine_days")
      .select("vehicle_id, day, drive_sec, idle_sec, off_sec, coverage_sec")
      .eq("org_id", orgId)
      .gte("day", w.fromDate)
      .order("day", { ascending: true })
      .order("vehicle_id", { ascending: true })
      .range(a, b),
  );
  const sessions = await readAll<RawSession>("idle_park_sessions", (a, b) =>
    admin
      .from("idle_park_sessions")
      .select("vehicle_id, started_at, ended_at, idle_sec, mode")
      .eq("org_id", orgId)
      .gte("started_at", w.fromIso)
      .lte("started_at", w.toIso)
      .order("started_at", { ascending: true })
      .order("vehicle_id", { ascending: true })
      .range(a, b),
  );
  const events = await readAll<RawEvent>("idle_events", (a, b) =>
    admin
      .from("idle_events")
      .select("vehicle_id, driver_id, started_at, duration_sec, air_temp_f")
      .eq("org_id", orgId)
      .gte("started_at", w.fromIso)
      .lte("started_at", w.toIso)
      .order("started_at", { ascending: true })
      .order("id", { ascending: true })
      .range(a, b),
  );
  const segments = await readAll<RawSegment>("hos_duty_segments", (a, b) =>
    admin
      .from("hos_duty_segments")
      .select("driver_id, vehicle_id, status, started_at, ended_at")
      .eq("org_id", orgId)
      .not("driver_id", "is", null)
      .gte("started_at", new Date(Date.parse(w.fromIso) - SEGMENT_PAD_MS).toISOString())
      .lte("started_at", w.toIso)
      .order("started_at", { ascending: true })
      .order("id", { ascending: true })
      .range(a, b),
  );
  const rawAssignments = await readAll<RawAssignment>("driver_vehicle_assignments", (a, b) =>
    admin
      .from("driver_vehicle_assignments")
      .select("vehicle_samsara_id, driver_samsara_id, start_at, end_at")
      .eq("org_id", orgId)
      .lte("start_at", w.toIso)
      .or(`end_at.is.null,end_at.gte.${w.fromIso}`)
      .order("start_at", { ascending: true })
      .order("vehicle_samsara_id", { ascending: true })
      .range(a, b),
  );
  return { engineDays, sessions, events, segments, rawAssignments };
}
