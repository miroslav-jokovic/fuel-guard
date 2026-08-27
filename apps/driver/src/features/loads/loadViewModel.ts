import {
  loadBucket,
  nextStop,
  stopProgress,
  type Load,
  type LoadStop,
} from '@silvicom/shared';
import type { LoadSummary, LoadStatus as CardStatus } from './LoadCard';
import type { ActiveLoad } from './CurrentLoadCard';

/**
 * Contract → view model. The `Load` shape mirrors the database; `LoadSummary`/`ActiveLoad` are what
 * the cards were designed against. Keeping the translation here means the screens never reshape data
 * inline and the card components never learn about the eight-state lifecycle — a driver only ever
 * sees five of those states anyway (D45).
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

function cardStatus(load: Load): CardStatus {
  const bucket = loadBucket(load.status);
  if (load.status === 'canceled') return 'canceled';
  if (load.status === 'delivered') return 'delivered';
  if (bucket === 'current') return 'in_transit';
  return 'upcoming';
}

function ends(load: Load): { first: LoadStop | undefined; last: LoadStop | undefined } {
  const ordered = [...load.stops].sort((a, b) => a.seq - b.seq);
  return { first: ordered[0], last: ordered[ordered.length - 1] };
}

export function toSummary(load: Load): LoadSummary {
  const { first, last } = ends(load);
  return {
    id: load.id,
    ref: load.ref,
    status: cardStatus(load),
    origin: placeLabel(first),
    originTime: stopTime(first?.appointment_start ?? null),
    destination: placeLabel(last),
    destTime: stopTime(last?.appointment_end ?? last?.appointment_start ?? null),
    stops: load.stops.length,
    miles: load.total_miles === null ? '—' : `${Math.round(load.total_miles).toLocaleString()} mi`,
    equipment: load.equipment ?? 'Load',
    ...(load.hazmat ? { hazmat: true } : {}),
  };
}

export function toActive(load: Load): ActiveLoad {
  const next = nextStop(load);
  return {
    ...toSummary(load),
    progress: stopProgress(load),
    nextStop: placeLabel(next),
    nextAction: next?.kind === 'dropoff' ? 'Deliver' : 'Pick up',
    appointment: appointmentLabel(next),
  };
}

/** The three tabs, already sorted the way a driver reads them. */
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
    (ends(a).first?.appointment_start ?? '').localeCompare(ends(b).first?.appointment_start ?? '');
  out.upcoming.sort(byFirstAppt);
  out.current.sort(byFirstAppt);
  out.previous.sort((a, b) => (b.completed_at ?? b.created_at).localeCompare(a.completed_at ?? a.created_at));
  return out;
}
