import { latePhotoOpen, missingPhotoSlots, nextStop, photoSlotLabel, stopProgress, type Load, type LoadStop } from '@silvicom/shared';
import type { Tone } from '@/components/tone';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';
import { countdownLabel } from './todayModel';

/**
 * What Today's signature block, its one next step and its rows SAY (Visual 2026 V5, the V1 mock's
 * screens 1, 3 and 9). `home.tsx` only draws these; every rule that decides the words lives here so
 * `apps/driver/tests/today-status-model.test.ts` can pin it.
 *
 * Three honesty limits bound everything below, and each one is a decision rather than an oversight:
 *
 * - **No ETA, no miles left** (D-DB8 / D-DV13). The only time on the block is the appointment, and
 *   the live line counts down to it. `total_miles` is the whole load, so it is not shown beside a stop.
 * - **No "Tight"** (Q-DV4, deferred to the feature plan). A closed window is said plainly, in amber.
 * - **No action the app cannot take.** The mock's screen 3 offers "Add" for a photo missing from a
 *   FINISHED stop. Until 2026-11-24 the server took none (`driver_complete_stop`, 0141, refuses any
 *   change to a finished stop), so the gap was a record with no action (Q-DV7). Migration 0645 added
 *   `driver_add_stop_photos` (D-DV30): a completed stop now takes a late photo for
 *   LATE_PHOTO_WINDOW_DAYS, and the row offers "Add photo" exactly while `latePhotoOpen` says the
 *   server will take it. After that, or on a skipped stop, it is a record again.
 */

export interface StatusBlockView {
  context?: string;
  subject?: string;
  place?: string;
  figure?: string;
  figureSuffix?: string;
  live?: string;
  /** `act` when the live line reports something late (amber, D-DV5); `live` otherwise (cyan). */
  liveTone: 'live' | 'act';
}

export type NextStepAction =
  | { kind: 'arrive'; loadId: string; stopId: string }
  | { kind: 'openStop'; loadId: string; stopId: string }
  | { kind: 'openLoad'; loadId: string };

export interface NextStepView {
  title: string;
  reason?: string;
  actionLabel: string;
  action: NextStepAction;
}

export interface DayRow {
  key: string;
  icon: MaterialSymbolName;
  /** Tints the glyph by state (ListRow `disc`); absent means a neutral row. */
  tone?: Tone;
  title: string;
  subtitle?: string;
  /** A trailing time, in the platform face with tabular digits, and the caption under it. */
  figure?: string;
  figureNote?: string;
  /** A trailing word in its state colour, instead of a figure ("Offered", "Change"). */
  word?: { text: string; tone: 'live' | 'act' | 'secondary' };
  href?: string;
}

// ── the signature block ──────────────────────────────────────────────────────

/** The load being worked: its next open stop, the window, and a countdown to it. */
export function activeLoadStatus(load: Load, now: number = Date.now()): StatusBlockView {
  const next = nextStop(load);
  if (!next) {
    return {
      context: `Load ${load.ref}`,
      subject: 'All stops done',
      place: 'Every stop on this load is finished.',
      liveTone: 'live',
    };
  }
  const progress = stopProgress(load);
  return {
    context: `${capitalise(kindWord(next))} · stop ${progress.current} of ${progress.total} · Load ${load.ref}`,
    subject: next.name,
    place: cityState(next) ?? undefined,
    ...windowFigure(next),
    ...liveLine(next, now),
  };
}

/** Before the shift: who is off duty in which truck, and when the day's first appointment is. */
export function preShiftStatus(input: {
  unit: string | null;
  firstLoad: Load | null;
  /** False when the fleet has the Loads tab off: no load will ever arrive, so none is promised. */
  loadsEnabled?: boolean;
  now?: number;
}): StatusBlockView {
  const context = input.unit ? `Off duty · Unit ${input.unit}` : 'Off duty';
  if (input.loadsEnabled === false) {
    return { context, subject: 'Start your shift when you are ready', liveTone: 'live' };
  }
  const first = input.firstLoad ? firstStop(input.firstLoad) : null;
  const at = first?.appointment_start ?? null;
  if (!first || !at) {
    return {
      context,
      subject: input.firstLoad ? `Load ${input.firstLoad.ref}` : 'No load assigned yet',
      place: input.firstLoad ? 'No appointment time on the first stop' : 'Released loads from dispatch appear here.',
      liveTone: 'live',
    };
  }
  const day = dayWord(at, input.now ?? Date.now());
  const { time, period } = heroClock(at);
  return {
    context,
    figure: time,
    ...(period ? { figureSuffix: period } : {}),
    live: [`First appointment${day ? ` ${day}` : ''}`, [first.name, first.city].filter(Boolean).join(', ')].join(' · '),
    liveTone: 'live',
  };
}

/** On duty with nothing in transit: the next load, if dispatch has sent one. */
export function betweenLoadsStatus(input: {
  elapsed: string | null;
  unit: string | null;
  nextLoad: Load | null;
  loadsEnabled?: boolean;
  now?: number;
}): StatusBlockView {
  const context = ['On duty', input.elapsed, input.unit ? `Unit ${input.unit}` : null].filter(Boolean).join(' · ');
  if (input.loadsEnabled === false) return { context, subject: 'Your shift is running', liveTone: 'live' };
  const first = input.nextLoad ? firstStop(input.nextLoad) : null;
  if (!input.nextLoad || !first) {
    return {
      context,
      subject: 'No load in progress',
      place: 'Your next load appears here when dispatch releases it.',
      liveTone: 'live',
    };
  }
  // The duty facts are the rig row's (Rest of the day); the block is about the next load.
  return {
    context: `Next load · ${input.nextLoad.ref}`,
    subject: first.name,
    place: [cityState(first), kindWord(first)].filter(Boolean).join(' · '),
    ...windowFigure(first),
    ...liveLine(first, input.now ?? Date.now()),
  };
}

// ── the one next step ────────────────────────────────────────────────────────

/**
 * The single recommended thing to do on the load being worked (Uber's "next step"), or null.
 *
 * - The next stop is still PENDING: say arrival is next, and what the stop will ask for after it.
 *   "Arrived" queues the same `arrived` update the stop screen's "Mark arrived" does
 *   (`useCompleteStop`, through the outbox, so it works in a dead zone).
 * - The driver has ARRIVED: name the photos still missing, or say the stop can be finished. Both open
 *   the stop screen, because finishing lives there with D21's reason step for a missing photo.
 */
export function activeNextStep(load: Load): NextStepView | null {
  const next = nextStop(load);
  if (!next) return null;
  const word = kindWord(next);
  const missing = missingPhotoSlots(next);
  const open = { kind: 'openStop', loadId: load.id, stopId: next.id } as const;

  if (next.status === 'pending') {
    return {
      title: `Arrive at ${word}`,
      reason: missing.length > 0 ? `Then the ${photoList(missing)} ${plural(missing.length, 'photo')}` : `Then finish the ${word}`,
      actionLabel: 'Arrived',
      action: { kind: 'arrive', loadId: load.id, stopId: next.id },
    };
  }
  if (missing.length > 0) {
    return {
      title: `Take the ${photoList(missing)} ${plural(missing.length, 'photo')}`,
      reason: `Needed before you finish at ${next.name}`,
      actionLabel: 'Open stop',
      action: open,
    };
  }
  return {
    title: `Finish the ${word}`,
    reason: next.required_photos.length > 0 ? 'Every photo is taken' : 'No photos are needed here',
    actionLabel: 'Open stop',
    action: open,
  };
}

/** Between loads: the next load, when one is waiting on the driver. */
export function betweenLoadsNextStep(nextLoad: Load | null): NextStepView | null {
  if (!nextLoad) return null;
  const route = routeLabel(nextLoad);
  if (nextLoad.status === 'offered') {
    return {
      title: 'A load is offered to you',
      reason: `Load ${nextLoad.ref}${route ? ` · ${route}` : ''}`,
      actionLabel: 'Review',
      action: { kind: 'openLoad', loadId: nextLoad.id },
    };
  }
  return {
    title: `Start load ${nextLoad.ref} when you roll`,
    reason: route ?? undefined,
    actionLabel: 'Open',
    action: { kind: 'openLoad', loadId: nextLoad.id },
  };
}

// ── the rows ─────────────────────────────────────────────────────────────────

/** The open stops AFTER the one in the status block, in run order. */
export function remainingStopRows(load: Load): DayRow[] {
  const next = nextStop(load);
  return ordered(load)
    .filter((s) => s.status !== 'completed' && s.status !== 'skipped' && s.id !== next?.id)
    .map((s) => ({
      key: `stop-${s.id}`,
      icon: s.kind === 'pickup' ? 'north' : 'south',
      title: s.name,
      subtitle: [cityState(s), kindWord(s)].filter(Boolean).join(' · '),
      figure: s.appointment_start ? clock(s.appointment_start) : undefined,
      figureNote: s.appointment_end ? `– ${clock(s.appointment_end)}` : undefined,
      href: `/loads/${load.id}/stop/${s.id}`,
    }));
}

/** Loads not started yet, as one row each. An offer says so in cyan: it is waiting on the driver. */
export function upcomingLoadRows(loads: readonly Load[], now: number = Date.now()): DayRow[] {
  return loads.map((l) => {
    const first = firstStop(l);
    return {
      key: `load-${l.id}`,
      icon: 'local_shipping',
      title: routeLabel(l) ?? `Load ${l.ref}`,
      subtitle: [`Load ${l.ref}`, l.equipment, l.hazmat ? 'Hazmat' : null].filter(Boolean).join(' · '),
      ...(l.status === 'offered'
        ? { word: { text: 'Offered', tone: 'live' as const } }
        : { figure: first?.appointment_start ? clock(first.appointment_start) : undefined,
            figureNote: first?.appointment_start ? dayWord(first.appointment_start, now) ?? 'today' : undefined }),
      href: `/loads/${l.id}`,
    };
  });
}

/**
 * What the driver finished today: the current load's worked stops, then loads delivered today.
 *
 * A stop completed without one of its required photos keeps its amber glyph and names the photo.
 * Inside the late-photo window it opens the stop, where the photo is taken and sent (D-DV30), with
 * "Add photo" in secondary ink: the amber stays with the glyph and Today's one next step (D-DV5).
 */
export function doneTodayRows(input: {
  current: Load | null;
  previous: readonly Load[];
  now?: number;
}): DayRow[] {
  const today = new Date(input.now ?? Date.now()).toDateString();
  const isToday = (iso: string) => new Date(iso).toDateString() === today;
  const rows: DayRow[] = [];

  for (const s of input.current ? ordered(input.current) : []) {
    const doneAt = s.completed_at;
    if ((s.status !== 'completed' && s.status !== 'skipped') || !doneAt || !isToday(doneAt)) continue;
    const missing = s.status === 'completed' ? missingPhotoSlots(s) : [];
    rows.push({
      key: `done-${s.id}`,
      icon: s.status === 'skipped' ? 'do_not_disturb_on' : missing.length > 0 ? 'warning' : 'check_circle',
      tone: s.status === 'skipped' ? 'neutral' : missing.length > 0 ? 'caution' : 'success',
      title: s.name,
      subtitle: [
        cityState(s),
        kindWord(s),
        missing.length > 0 ? `${capitalise(photoList(missing))} ${plural(missing.length, 'photo')} missing` : null,
      ].filter(Boolean).join(' · '),
      ...(missing.length > 0 && latePhotoOpen(s, input.now ?? Date.now()) && input.current
        ? { word: { text: 'Add photo', tone: 'secondary' as const }, href: `/loads/${input.current.id}/stop/${s.id}` }
        : { figure: clock(doneAt), figureNote: s.status === 'skipped' ? 'skipped' : 'completed' }),
    });
  }
  for (const l of input.previous) {
    const deliveredAt = l.completed_at;
    if (l.status !== 'delivered' || !deliveredAt || !isToday(deliveredAt)) continue;
    rows.push({
      key: `delivered-${l.id}`,
      icon: 'check_circle',
      tone: 'success',
      title: routeLabel(l) ?? `Load ${l.ref}`,
      subtitle: `Load ${l.ref}`,
      figure: clock(deliveredAt),
      figureNote: 'delivered',
      href: `/loads/${l.id}`,
    });
  }
  return rows;
}

/** The rig the driver signed on to, with the swap a tap away (D-DB17, now a row). */
export function rigRow(duty: {
  vehicleUnit: string | null;
  trailerUnit: string | null;
  elapsed: string | null;
}): DayRow {
  return {
    key: 'rig',
    icon: 'local_shipping',
    title: rigTitle(duty.vehicleUnit, duty.trailerUnit),
    subtitle: duty.elapsed ? `On duty ${duty.elapsed}` : 'On duty',
    word: { text: 'Change', tone: 'secondary' },
    href: '/duty/check-in?mode=swap',
  };
}

/**
 * Before the shift, the rig the one-tap start will use (`startShortcutModel`). It is shown because a
 * pinned "Start shift" that does not say which truck it starts in would be a guess the driver cannot
 * see. "Change" opens the full check-in instead.
 */
export function startRigRow(vehicleUnit: string, trailerUnit: string | null): DayRow {
  return {
    key: 'start-rig',
    icon: 'local_shipping',
    title: rigTitle(vehicleUnit, trailerUnit),
    subtitle: trailerUnit ? 'Same rig as your last shift' : 'Same truck as your last shift',
    word: { text: 'Change', tone: 'secondary' },
    href: '/duty/check-in',
  };
}

/** "Unit 2241 · trailer 53118", "Unit 2241 · bobtail", or "Truck not recorded". */
export function rigTitle(vehicleUnit: string | null, trailerUnit: string | null): string {
  if (!vehicleUnit) return 'Truck not recorded';
  return `Unit ${vehicleUnit} · ${trailerUnit ? `trailer ${trailerUnit}` : 'bobtail'}`;
}

// ── formatting ───────────────────────────────────────────────────────────────

/** The time alone, in the phone's own clock format. */
export function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Null for today, then "tomorrow", then "on Wed": the words a driver would use. */
export function dayWord(iso: string, now: number): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const n = new Date(now);
  const days = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
      - new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime()) / 86_400_000,
  );
  if (days === 0) return null;
  if (days === 1) return 'tomorrow';
  return `on ${d.toLocaleDateString(undefined, { weekday: 'short' })}`;
}

function windowFigure(stop: LoadStop): Pick<StatusBlockView, 'figure' | 'figureSuffix'> {
  const at = stop.appointment_start ?? stop.appointment_end;
  if (!at) return {};
  const { time, period } = heroClock(at);
  // A close-only window ("by 16:00") still has one honest figure.
  const tail = stop.appointment_start
    ? (stop.appointment_end ? `– ${clock(stop.appointment_end)}` : null)
    : 'latest';
  const suffix = [period, tail].filter(Boolean).join(' ');
  return { figure: time, figureSuffix: suffix || undefined };
}

/**
 * The clock split for the hero figure: "4:27" and "PM". On a 12-hour phone the day period set in the
 * display face at 64pt made "PM" as loud as the time itself, so it moves into the smaller suffix
 * beside the figure. A 24-hour phone has no period and the figure is the whole time.
 */
export function heroClock(iso: string): { time: string; period: string | null } {
  return splitDayPeriod(clock(iso));
}

/** "4:27 PM" → 4:27 + PM; "04:27 a.m." → 04:27 + a.m.; "16:27" stays whole. */
export function splitDayPeriod(text: string): { time: string; period: string | null } {
  const match = /^(.*?\d)[\s\u202f\u00a0]*([^\d\s][^\d]*)$/.exec(text);
  if (!match?.[1] || !match[2]) return { time: text, period: null };
  return { time: match[1], period: match[2].trim() };
}

function liveLine(stop: LoadStop, now: number): Pick<StatusBlockView, 'live' | 'liveTone'> {
  const countdown = countdownLabel(stop, now);
  if (!countdown) return { live: stop.appointment_end ? undefined : 'No appointment time', liveTone: 'live' };
  return { live: countdown.text, liveTone: countdown.tone === 'warning' ? 'act' : 'live' };
}

function kindWord(stop: Pick<LoadStop, 'kind'>): 'pickup' | 'delivery' {
  return stop.kind === 'pickup' ? 'pickup' : 'delivery';
}

function cityState(stop: Pick<LoadStop, 'city' | 'state'>): string | null {
  return [stop.city, stop.state].filter(Boolean).join(', ') || null;
}

function routeLabel(load: Load): string | null {
  const stops = ordered(load);
  const from = stops[0]?.city;
  const to = stops[stops.length - 1]?.city;
  if (!from || !to || stops.length < 2) return null;
  return `${from} → ${to}`;
}

function ordered(load: Pick<Load, 'stops'>): LoadStop[] {
  return [...load.stops].sort((a, b) => a.seq - b.seq);
}

function firstStop(load: Load): LoadStop | null {
  return ordered(load)[0] ?? null;
}

/** "BOL and seal", "trailer, BOL and seal": lower case, because it sits mid-sentence. */
function photoList(slots: readonly string[]): string {
  const words = slots.map((s) => (s === 'bol' ? 'BOL' : photoSlotLabel(s).toLowerCase()));
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
