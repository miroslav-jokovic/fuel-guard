import { durationWords } from '@/lib/duration';
import { missingPhotoSlots, nextStop, type Load, type LoadStop } from '@silvicom/shared';

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

/** The phone's own duration words ("2 hr, 55 min"), shared with Today and the Lock Screen. */
const describe = durationWords;

// ── Visual 2026 V6: the timeline and the stop screen ─────────────────────────────────────────────

/**
 * One stop on Load detail's timeline (the V1 mock's screen 5): rows on a 2pt rail, no cards. The
 * window is the largest thing in each stop; the photos it needs are words, not a counter.
 */
export interface TimelineStopView {
  id: string;
  /** The dot: cyan for the stop being worked, green done, hollow ahead, amber hollow skipped. */
  state: NodeState;
  kind: string;
  name: string;
  address: string;
  window: string | null;
  /** The countdown or verdict beside the window, for the next stop only. */
  live: { text: string; tone: 'live' | 'act' | 'done' } | null;
  needs: { text: string; tone: 'secondary' | 'done' | 'act' } | null;
  tappable: boolean;
}

export function timelineStops(load: Load, now: number = Date.now()): TimelineStopView[] {
  return itineraryRows(load).map(({ stop, state }) => {
    const verdict = state === 'next' ? windowVerdict(stop, now) : null;
    return {
      id: stop.id,
      state,
      kind: kindLine(stop, state),
      name: stop.name,
      address: [stop.address_line, [stop.city, stop.state].filter(Boolean).join(', '), stop.postal_code]
        .filter(Boolean)
        .join(', '),
      window: windowText(stop),
      live: verdict ? { text: verdict.title, tone: verdictTone(verdict) } : null,
      needs: needsLine(stop),
      tappable: state === 'next',
    };
  });
}

function kindLine(stop: LoadStop, state: NodeState): string {
  const kind = stop.kind === 'pickup' ? 'Pickup' : 'Delivery';
  if (state === 'complete') return `${kind} · done${stop.completed_at ? ` ${clock(stop.completed_at)}` : ''}`;
  if (state === 'skipped') return `${kind} · skipped`;
  if (state === 'next' && stop.status === 'arrived') return `${kind} · arrived${stop.arrived_at ? ` ${clock(stop.arrived_at)}` : ''}`;
  return kind;
}

/** "Needs: BOL · seal" while anything is missing; "All photos taken" once nothing is. */
function needsLine(stop: LoadStop): TimelineStopView['needs'] {
  if (stop.required_photos.length === 0) return null;
  const missing = missingPhotoSlots(stop);
  if (missing.length === 0) return { text: 'All photos taken', tone: 'done' };
  // A finished stop that still lacks a photo is a record in amber (Q-DV7), not a task.
  const finished = stop.status === 'completed' || stop.status === 'skipped';
  return { text: `${finished ? 'Missing' : 'Needs'}: ${missing.map(slotWord).join(' · ')}`, tone: finished ? 'act' : 'secondary' };
}

export function windowText(stop: Pick<LoadStop, 'appointment_start' | 'appointment_end'>): string | null {
  if (stop.appointment_start && stop.appointment_end) return `${clock(stop.appointment_start)} – ${clock(stop.appointment_end)}`;
  if (stop.appointment_start) return clock(stop.appointment_start);
  if (stop.appointment_end) return `by ${clock(stop.appointment_end)}`;
  return null;
}

export function verdictTone(verdict: WindowVerdict): 'live' | 'act' | 'done' {
  if (verdict.tone === 'warning') return 'act';
  return verdict.tone === 'success' ? 'done' : 'live';
}

function slotWord(slot: string): string {
  return slot === 'bol' ? 'BOL' : slot.replace(/_/g, ' ');
}

export interface PhotoRowView {
  slot: string;
  state: PhotoTileState;
  /** "Required", "Taken 06:02", "Already added". */
  detail: string;
  /** The trailing word: amber "Take" for a missing photo (D-DV5: act), "Retake" otherwise. */
  action: { text: string; tone: 'act' | 'secondary' };
}

/** The stop screen's photos as rows (mock screen 6), missing ones first. */
export function photoRows(
  stop: Pick<LoadStop, 'required_photos' | 'photos'>,
  captures: readonly { slot: string; capturedAt: string | number }[],
): PhotoRowView[] {
  const rows = stop.required_photos.map((slot): PhotoRowView => {
    const state = photoTileState(slot, stop, captures);
    const shot = captures.find((c) => c.slot === slot);
    return {
      slot,
      state,
      detail: state === 'captured' && shot ? `Taken ${clock(new Date(shot.capturedAt).toISOString())}` : state === 'already' ? 'Already added' : 'Required',
      action: state === 'required' ? { text: 'Take', tone: 'act' } : { text: 'Retake', tone: 'secondary' },
    };
  });
  return [...rows.filter((r) => r.state === 'required'), ...rows.filter((r) => r.state !== 'required')];
}

/**
 * Where the phone's own maps app should take the driver. Coordinates when dispatch geocoded the stop,
 * otherwise the address as a search. The app computes no route and shows no ETA (D-DV13): it hands
 * the trip to the maps app, which is what "Navigate" says it does.
 */
export function mapsUrl(
  stop: Pick<LoadStop, 'lat' | 'lon' | 'name' | 'address_line' | 'city' | 'state' | 'postal_code'>,
  platform: 'ios' | 'android',
): string | null {
  const address = [stop.address_line, stop.city, stop.state, stop.postal_code].filter(Boolean).join(', ');
  const target = stop.lat != null && stop.lon != null ? `${stop.lat},${stop.lon}` : address;
  if (!target) return null;
  const q = encodeURIComponent(target);
  return platform === 'ios' ? `https://maps.apple.com/?daddr=${q}` : `google.navigation:q=${q}`;
}
