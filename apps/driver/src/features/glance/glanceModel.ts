import { nextStop, type Load } from '@silvicom/shared';
import roleValues from '@/theme/theme.roles.json';
import { TYPE, type TextVariant, type TextWeight } from '@/theme/typography';
import { countdownLabel } from '@/screens/today/todayModel';
import { activeLoadStatus, clock } from '@/screens/today/todayStatusModel';

/**
 * What the glance surfaces say (Visual 2026 V9, D-DV25): the iOS Live Activity, the lock-screen
 * widget and the Android home-screen widget. They all show ONE thing, the stop being driven to, and
 * every word comes from Today's own model (`activeLoadStatus`, `countdownLabel`). The lock screen and
 * Today therefore cannot disagree, and nothing here restates a rule Today already owns.
 *
 * The layouts (`StopActivity`, `StopWidget`) run in the widget extension's isolated runtime. That
 * runtime has no imports and no module scope, so everything they draw, colours included, arrives as
 * props built here. That is also why this file is pure and the layouts are dumb: a layout cannot be
 * unit-tested off a device, and this can (`apps/driver/tests/glance-model.test.ts`).
 *
 * Honesty limits, the same as Today's (D-DB8 / D-DV13): no ETA and no miles. The one moving figure is
 * a countdown to a real appointment time, drawn by the system clock (`Text` with a timer), so it stays
 * right on a locked phone with the app asleep. Each phase change is a timeline entry for the widget and
 * a stale date for the Live Activity; that is the most a surface can promise without a server push.
 */

/** Colours the layouts paint with, as hex, from the dark theme (the hero is navy in both themes). */
export interface GlanceColors {
  hero: string;
  onHero: string;
  onHeroSecondary: string;
  onHeroLive: string;
  onHeroAct: string;
}

/** A size and weight from `typography.ts`'s variants: the widget runtime cannot call `textStyle()`. */
export interface GlanceFont {
  size: number;
  weight: TextWeight;
}

/** The type roles the glance layouts set, each one of the app's own variants (D-DV16). */
export interface GlanceType {
  context: GlanceFont;
  title: GlanceFont;
  place: GlanceFont;
  figure: GlanceFont;
  line: GlanceFont;
  caption: GlanceFont;
}

/** The props every glance layout receives. Plain JSON: it crosses into the widget runtime. */
export interface GlanceProps {
  /** `stop` while a stop is being driven to; `idle` when there is none (the widget stays honest). */
  mode: 'stop' | 'idle';
  /** "Pickup · stop 1 of 2 · Load 1184530", or the duty word when idle. */
  context: string;
  /** The stop's name, or what the driver is doing when idle. */
  title: string;
  /** "Chicago, IL"; empty when unknown. */
  place: string;
  /** The appointment as a clock: "6:00 AM – 8:00 AM", "4:00 PM latest"; empty when there is none. */
  window: string;
  /** The appointment's one time, for the Dynamic Island's narrow slots: "6:00 AM"; empty when none. */
  at: string;
  /** What the window is doing at this entry's instant, in Today's words ("Window open now"); empty
   *  while the timer counts, because the timer says it. */
  line: string;
  /** `act` (amber) when the line reports something late, `live` (cyan) otherwise (D-DV5). */
  lineTone: 'live' | 'act';
  /**
   * Epoch ms the system timer counts down to; ABSENT when nothing is counting. Never null: the props
   * cross into native code as a dictionary, and a Swift `[String: Any]` cannot hold a null. One null
   * here made `createWidget` throw at app start, taking the whole app down (V9, measured).
   */
  countdownTo?: number;
  /** The words beside the running timer; the start of `countdownLabel`'s own sentence. */
  countdownCaption: string;
  /** Where a tap opens the app. */
  url: string;
  colors: GlanceColors;
  type: GlanceType;
}

/** One timeline entry: the props to show from `at` (epoch ms) on. */
export interface GlanceEntry {
  at: number;
  props: GlanceProps;
}

const SCHEME = 'fuelguard://';

/** `countdownLabel` says "Window opens in 18 min"; beside a live timer only its first words are needed. */
export const COUNTDOWN_CAPTION = 'Window opens in';

/** The stop being driven to, or null: on duty, a load in progress, and an open stop left on it. */
export function glanceStopLoad(input: { onDuty: boolean; currentLoad: Load | null }): Load | null {
  if (!input.onDuty || !input.currentLoad) return null;
  return nextStop(input.currentLoad) ? input.currentLoad : null;
}

/** The props at one instant. Today's block decides the words; this only lays them out. */
export function glanceProps(load: Load, at: number): GlanceProps {
  const stop = nextStop(load);
  if (!stop) return idleProps('On duty');
  const block = activeLoadStatus(load, at);
  const countdown = countdownLabel(stop, at);
  const start = stop.appointment_start ? Date.parse(stop.appointment_start) : NaN;
  const counting = Number.isFinite(start) && start > at;
  const appointment = stop.appointment_start ?? stop.appointment_end;
  return {
    mode: 'stop',
    context: block.context ?? '',
    title: block.subject ?? stop.name,
    place: block.place ?? '',
    window: [block.figure, block.figureSuffix].filter(Boolean).join(' '),
    at: appointment ? clock(appointment) : '',
    // While the system timer counts, no layout draws the line, and its minutes would change the props
    // every minute: a widget reload and a Live Activity update a minute, against Apple's budgets.
    line: counting ? '' : (countdown?.text ?? block.live ?? ''),
    lineTone: countdown?.tone === 'warning' ? 'act' : 'live',
    // The system timer runs only while the window is still ahead: past the start there is nothing
    // to count down to, and a timer counting UP would read as time remaining.
    ...(counting ? { countdownTo: start } : {}),
    countdownCaption: counting ? COUNTDOWN_CAPTION : '',
    url: `${SCHEME}loads/${load.id}/stop/${stop.id}`,
    colors: GLANCE_COLORS,
    type: GLANCE_TYPE,
  };
}

/** What the widget shows when no stop is being driven to. */
export function idleProps(context: 'Off duty' | 'On duty'): GlanceProps {
  return {
    mode: 'idle',
    context,
    title: 'No stop in progress',
    place: '',
    window: '',
    at: '',
    line: '',
    lineTone: 'live',
    countdownCaption: '',
    url: `${SCHEME}home`,
    colors: GLANCE_COLORS,
    type: GLANCE_TYPE,
  };
}

/**
 * The widget's timeline: now, then each instant the window's phase changes (it opens, it closes).
 * Each entry's words come from `countdownLabel` AT that instant, so the lock screen turns from
 * "Window opens in …" to "Window open now" to "Window closed" with the app asleep.
 */
export function glanceTimeline(load: Load | null, now: number, onDuty: boolean): GlanceEntry[] {
  if (!load) return [{ at: now, props: idleProps(onDuty ? 'On duty' : 'Off duty') }];
  const stop = nextStop(load);
  if (!stop) return [{ at: now, props: idleProps('On duty') }];
  const instants = [now, ...phaseChanges(stop, now)];
  return instants.map((at) => ({ at, props: glanceProps(load, at) }));
}

/**
 * When the Live Activity's content goes out of date: the next phase change, or null when none is
 * ahead. The system marks the activity stale then (`environment.isStale`), and the layout swaps the
 * stopped timer for words that stay true until the app refreshes it.
 */
export function glanceStaleAt(load: Load, now: number): number | null {
  const stop = nextStop(load);
  return stop ? (phaseChanges(stop, now)[0] ?? null) : null;
}

/** What the Live Activity must do to match the state: nothing, start, update or end. */
export type ActivityCommand =
  | { kind: 'none' }
  | { kind: 'start'; props: GlanceProps; staleAt: number | null }
  | { kind: 'update'; props: GlanceProps; staleAt: number | null }
  | { kind: 'end' };

/**
 * The Live Activity follows the stop: one while a stop is being driven to, none otherwise. `shown`
 * is what the running activity last displayed (null when none runs), so an unchanged minute is no
 * update. Apple budgets Live Activity updates, and a write per tick would spend it on nothing.
 */
export function activityCommand(input: {
  running: boolean;
  shown: GlanceProps | null;
  load: Load | null;
  now: number;
}): ActivityCommand {
  if (!input.load) return input.running ? { kind: 'end' } : { kind: 'none' };
  const props = glanceProps(input.load, input.now);
  const staleAt = glanceStaleAt(input.load, input.now);
  if (!input.running) return { kind: 'start', props, staleAt };
  return sameProps(input.shown, props) ? { kind: 'none' } : { kind: 'update', props, staleAt };
}

export function sameProps(a: GlanceProps | null, b: GlanceProps | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The instants after `now` at which `countdownLabel`'s answer for the stop changes. */
function phaseChanges(stop: { appointment_start: string | null; appointment_end: string | null }, now: number): number[] {
  const start = stop.appointment_start ? Date.parse(stop.appointment_start) : NaN;
  const end = stop.appointment_end ? Date.parse(stop.appointment_end) : NaN;
  // `countdownLabel` has no countdown without a start, so a close-only window never changes phase.
  if (!Number.isFinite(start)) return [];
  const changes = [start];
  // "Window closed" is said from the first millisecond after the end.
  if (Number.isFinite(end) && end >= start) changes.push(end + 1);
  return changes.filter((t) => t > now);
}

function hex(role: keyof (typeof roleValues)['dark']): string {
  return `#${roleValues.dark[role]
    .split(' ')
    .map((channel) => Number(channel).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

/** Read from the role theme, never restated: a token change reaches the lock screen too. */
export const GLANCE_COLORS: GlanceColors = {
  hero: hex('hero'),
  onHero: hex('on-hero'),
  onHeroSecondary: hex('on-hero-secondary'),
  onHeroLive: hex('on-hero-live'),
  onHeroAct: hex('on-hero-act'),
};

function variant(name: TextVariant, weight?: TextWeight): GlanceFont {
  return { size: TYPE[name].fontSize, weight: weight ?? TYPE[name].weight };
}

/**
 * Read from the type scale, never restated (D-DV16): the stop is a row title, the window a numeric
 * figure, the rest captions. The display face is not bundled into the widget extension, so the figure
 * is `numericInline`, which D-DV15 sets in the platform face with tabular digits anyway.
 */
export const GLANCE_TYPE: GlanceType = {
  context: variant('caption'),
  title: variant('rowTitle'),
  place: variant('caption'),
  figure: variant('numericInline'),
  line: variant('supporting', 'semibold'),
  caption: variant('caption'),
};
