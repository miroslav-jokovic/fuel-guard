import { nextStop, type Load, type LoadStop } from '@silvicom/shared';
import { acceptedUpcoming, orderOffers } from './offerDeckModel';

/**
 * What the Loads tab says (Visual 2026 V6, the V1 mock's screen 4), decided here so
 * `apps/driver/tests/loads-list-model.test.ts` can pin it.
 *
 * The list is grouped by TIME, not by status: what is being driven now, what is next, what was
 * delivered this week, then everything earlier. Direction B grouped by status behind four chips, so
 * a driver had to know which chip a load was filed under before they could see it. Offers stay
 * apart, first, because they are the one item with somebody waiting on an answer.
 *
 * Every row's trailing figure is an appointment (or the day a load finished), set in tabular digits
 * so the times line up. Miles are the whole load's length from dispatch, never "miles left" (D-DV13).
 */

export type LoadGroupKey = 'now' | 'next' | 'thisWeek' | 'earlier';

export interface LoadRowView {
  key: string;
  loadId: string;
  /** `live` = the load being driven (cyan glyph), `done` = delivered (green), `off` = canceled. */
  state: 'live' | 'ahead' | 'done' | 'off';
  title: string;
  subtitle: string;
  figure?: string;
  figureNote?: string;
}

export interface LoadGroup {
  key: LoadGroupKey;
  title: string;
  rows: LoadRowView[];
}

export interface LoadsListView {
  offers: Load[];
  groups: LoadGroup[];
}

export function loadsListView(loads: readonly Load[], now: number = Date.now()): LoadsListView {
  const upcoming = loads.filter((l) => l.status !== 'in_transit' && l.status !== 'delivered' && l.status !== 'canceled');
  const current = loads
    .filter((l) => l.status === 'in_transit')
    .sort((a, b) => (firstStart(a) ?? '').localeCompare(firstStart(b) ?? ''));
  const finished = loads
    .filter((l) => l.status === 'delivered' || l.status === 'canceled')
    .sort((a, b) => finishedAt(b).localeCompare(finishedAt(a)));
  const weekAgo = now - 7 * 86_400_000;
  const thisWeek = finished.filter((l) => Date.parse(finishedAt(l)) >= weekAgo);
  const earlier = finished.filter((l) => Date.parse(finishedAt(l)) < weekAgo);

  const groups: LoadGroup[] = [
    { key: 'now' as const, title: 'Now', rows: current.map((l) => currentRow(l, now)) },
    { key: 'next' as const, title: 'Next', rows: acceptedUpcoming(upcoming).map((l) => aheadRow(l, now)) },
    { key: 'thisWeek' as const, title: 'Delivered this week', rows: thisWeek.map(finishedRow) },
    { key: 'earlier' as const, title: 'Earlier', rows: earlier.map(finishedRow) },
  ].filter((g) => g.rows.length > 0);

  return { offers: orderOffers(upcoming), groups };
}

/** "Chicago, IL → Indianapolis, IN · 183 mi": where the load goes and how long it is. */
export function routeLine(load: Load, withMiles = true): string {
  const stops = ordered(load);
  const from = place(stops[0]);
  const to = place(stops[stops.length - 1]);
  const route = stops.length > 1 && from && to ? `${from} → ${to}` : (from ?? to ?? '');
  const miles = withMiles && load.total_miles != null ? `${Math.round(load.total_miles).toLocaleString()} mi` : null;
  return [route || null, miles].filter(Boolean).join(' · ');
}

function currentRow(load: Load, now: number): LoadRowView {
  const next = nextStop(load);
  const at = next?.appointment_start ?? next?.appointment_end ?? null;
  return {
    key: `now-${load.id}`,
    loadId: load.id,
    state: 'live',
    title: `Load ${load.ref}`,
    subtitle: routeLine(load),
    ...(at ? { figure: clock(at), figureNote: noteFor(at, now, 'next window') } : {}),
  };
}

function aheadRow(load: Load, now: number): LoadRowView {
  const first = ordered(load)[0];
  const at = first?.appointment_start ?? null;
  return {
    key: `next-${load.id}`,
    loadId: load.id,
    state: 'ahead',
    title: `Load ${load.ref}`,
    subtitle: [routeLine(load), load.hazmat ? 'Hazmat' : null].filter(Boolean).join(' · '),
    ...(at ? { figure: clock(at), figureNote: noteFor(at, now, first?.kind === 'dropoff' ? 'delivery' : 'pickup') } : {}),
  };
}

function finishedRow(load: Load): LoadRowView {
  const at = finishedAt(load);
  const d = new Date(at);
  const valid = !Number.isNaN(d.getTime());
  return {
    key: `done-${load.id}`,
    loadId: load.id,
    state: load.status === 'canceled' ? 'off' : 'done',
    title: `Load ${load.ref}`,
    subtitle: [routeLine(load, false), load.status === 'canceled' ? 'Canceled' : null].filter(Boolean).join(' · '),
    ...(valid
      ? {
          figure: d.toLocaleDateString(undefined, { weekday: 'short' }),
          figureNote: `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`,
        }
      : {}),
  };
}

/**
 * The trailing figure is the time alone, and the day goes in the note under it ("Sun · pickup").
 * "Sun 3:59 PM" as one figure was wide enough to push the route under it onto two lines (simulator,
 * 2026-11-20), and the column of times stopped lining up.
 */
export function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** "pickup" today, "Sun · pickup" on another day. */
export function noteFor(iso: string, now: number, what: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.toDateString() === new Date(now).toDateString()) return what;
  return `${d.toLocaleDateString(undefined, { weekday: 'short' })} · ${what}`;
}

function finishedAt(load: Load): string {
  return load.completed_at ?? load.created_at;
}

function firstStart(load: Load): string | null {
  return ordered(load)[0]?.appointment_start ?? null;
}

function ordered(load: Pick<Load, 'stops'>): LoadStop[] {
  return [...load.stops].sort((a, b) => a.seq - b.seq);
}

function place(stop: LoadStop | undefined): string | null {
  if (!stop) return null;
  return [stop.city, stop.state].filter(Boolean).join(', ') || stop.name;
}
