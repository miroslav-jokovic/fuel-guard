import { missingPhotoSlots, nextStop, type Load, type LoadStop } from '@silvicom/shared';
import type { Tone } from '@/components';

/**
 * The itinerary's rules, kept out of the component so a node's colour and a window's verdict can be
 * tested. Both are the kind of thing that looks right on a simulator with three fixtures and is
 * wrong on a real load with a skipped stop in the middle of it.
 */
export type NodeState = 'complete' | 'next' | 'pending' | 'skipped';

export function nodeState(stop: LoadStop, next: LoadStop | null): NodeState {
  if (stop.status === 'skipped') return 'skipped';
  if (stop.status === 'completed') return 'complete';
  return next?.id === stop.id ? 'next' : 'pending';
}

export const NODE_TONE: Record<NodeState, Tone> = {
  complete: 'success',
  next: 'brand',
  pending: 'neutral',
  skipped: 'warning',
};

export const NODE_LABEL: Record<NodeState, string> = {
  complete: 'Complete',
  next: 'Next',
  pending: 'Pending',
  skipped: 'Skipped',
};

/**
 * The connector ABOVE a stop is green only when the stop it leads out of is genuinely finished.
 * A skipped stop does not colour its connector: the run did not pass through it, and a green line
 * would read as "done here" on the one stop nobody worked.
 */
export function connectorDone(stopAbove: LoadStop | undefined): boolean {
  return stopAbove?.status === 'completed';
}

export interface WindowVerdict {
  title: string;
  detail: string;
  tone: 'success' | 'warning' | 'neutral';
}

/**
 * Where the driver stands relative to the appointment, in one line each of verdict and arithmetic.
 *
 * `arrived_at` is used when it exists, because after the fact the question is "was I on time",
 * not "am I on time" — a stop marked arrived at 13:50 for a 14:00 window stays "inside the window"
 * at 16:30, and re-judging it against `now` would turn a good arrival into a late one on re-open.
 */
export function windowVerdict(
  stop: Pick<LoadStop, 'appointment_start' | 'appointment_end' | 'arrived_at'>,
  now: number = Date.now(),
): WindowVerdict | null {
  const start = stop.appointment_start ? Date.parse(stop.appointment_start) : NaN;
  const end = stop.appointment_end ? Date.parse(stop.appointment_end) : NaN;
  if (!Number.isFinite(start) && !Number.isFinite(end)) return null;

  const at = stop.arrived_at ? Date.parse(stop.arrived_at) : now;
  const arrived = Boolean(stop.arrived_at);
  const window = `Appt ${clock(stop.appointment_start)}${stop.appointment_end ? `–${clock(stop.appointment_end)}` : ''}`;
  const word = arrived ? 'Arrived' : 'Now';

  if (Number.isFinite(start) && at < start) {
    const mins = Math.max(1, Math.round((start - at) / 60_000));
    return {
      title: arrived ? 'Early for the window' : `Window opens in ${describe(mins)}`,
      detail: `${window} · ${word} ${describe(mins)} early`,
      tone: 'neutral',
    };
  }
  if (Number.isFinite(end) && at > end) {
    const mins = Math.max(1, Math.round((at - end) / 60_000));
    return { title: 'Past the window', detail: `${window} · ${word} ${describe(mins)} late`, tone: 'warning' };
  }
  return { title: 'Inside the window', detail: `${window} · ${word} on time`, tone: 'success' };
}

export type PhotoTileState = 'captured' | 'already' | 'required';

/**
 * What a photo slot's tile says. `captured` is a photo taken in THIS session and still on the phone
 * (so a thumbnail exists); `already` is a slot the server has satisfied on a previous visit, where
 * the app has the fact but not the image.
 */
export function photoTileState(
  slot: string,
  stop: Pick<LoadStop, 'required_photos' | 'photos'>,
  captures: readonly { slot: string }[],
): PhotoTileState {
  if (captures.some((c) => c.slot === slot)) return 'captured';
  return stop.photos.some((p) => p.slot === slot) ? 'already' : 'required';
}

/** "3 of 4" for a stop's photo line, counting a capture from this session as satisfied. */
export function photoCount(
  stop: Pick<LoadStop, 'required_photos' | 'photos'>,
  captures: readonly { slot: string }[] = [],
): { have: number; total: number } {
  const total = stop.required_photos.length;
  const missing = missingPhotoSlots(stop).filter((slot) => !captures.some((c) => c.slot === slot));
  return { have: total - missing.length, total };
}

/** The itinerary's rows, in seq order, with the one stop that is tappable already identified. */
export function itineraryRows(load: Load): { stop: LoadStop; state: NodeState; connectorDone: boolean }[] {
  const ordered = [...load.stops].sort((a, b) => a.seq - b.seq);
  const next = nextStop(load);
  return ordered.map((stop, index) => ({
    stop,
    state: nodeState(stop, next),
    connectorDone: connectorDone(ordered[index - 1]),
  }));
}

function clock(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function describe(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
