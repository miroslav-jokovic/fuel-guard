import { loadBucket, type Load, type LoadStop } from '@silvicom/shared';

/**
 * The shared formatters every load surface reads a stop through.
 *
 * This file used to be a contract → view-model translation layer, because the cards it fed were
 * designed against a different shape (`LoadSummary`, `ActiveLoad`). Direction B's rows read the
 * contract directly, so the translation went with the cards and only the formatting stayed.
 */

/** Short, driver-readable time: "Today 06:30", "Tomorrow 08:00", "Wed 07:00", "—". */
export function stopTime(iso: string | null, now = new Date()): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const days = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      86_400_000,
  );
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days === -1) return `Yesterday ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
}

/** "Appt 12:00 – 14:00", or a single-sided window, or a plain dash. */
export function appointmentLabel(stop: Pick<LoadStop, 'appointment_start' | 'appointment_end'> | null): string {
  if (!stop?.appointment_start && !stop?.appointment_end) return 'No appointment window';
  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';
  const from = fmt(stop?.appointment_start ?? null);
  const to = fmt(stop?.appointment_end ?? null);
  if (from && to) return `Appt ${from} – ${to}`;
  return `Appt ${from || to}`;
}

/** City, ST — falling back to the facility name so a row is never blank. */
export function placeLabel(stop: LoadStop | undefined | null): string {
  if (!stop) return '—';
  const city = [stop.city, stop.state].filter(Boolean).join(', ');
  return city || stop.name;
}

/** The three buckets the driver app groups loads into, already sorted the way a driver reads them. */
export interface BucketedLoads {
  upcoming: Load[];
  current: Load[];
  previous: Load[];
}

export function bucketLoads(loads: readonly Load[]): BucketedLoads {
  const out: BucketedLoads = { upcoming: [], current: [], previous: [] };
  for (const load of loads) out[loadBucket(load.status)].push(load);
  // Soonest first for work ahead; most recent first for work behind.
  const byFirstAppt = (a: Load, b: Load) =>
    (firstStop(a)?.appointment_start ?? '').localeCompare(firstStop(b)?.appointment_start ?? '');
  out.upcoming.sort(byFirstAppt);
  out.current.sort(byFirstAppt);
  out.previous.sort((a, b) => (b.completed_at ?? b.created_at).localeCompare(a.completed_at ?? a.created_at));
  return out;
}

function firstStop(load: Load): LoadStop | undefined {
  return [...load.stops].sort((a, b) => a.seq - b.seq)[0];
}
