import {
  equipmentRequiresTrailer,
  messagePreview,
  threadTitle,
  type Load,
  type MeHazmatLoadRow,
  type NotificationEvent,
  type Thread,
} from '@silvicom/shared';
import type { Tone } from '@/components';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';
import { CATEGORY_ICON } from '@/features/notifications/categoryIcon';
import type { DutyView } from '@/features/duty/useDuty';

/**
 * What Today IS, as a function of the day rather than a fixed template.
 *
 * The 2026-09-07 critique's first P0: Today implemented one composition for every situation, so a
 * driver at 05:40 with no shift, a driver mid-run, and a driver whose profile failed to load all got
 * the same three cards in the same order — filling 35–55% of the viewport in the states that matter
 * most. A driver looks at this screen for two seconds at a time; the screen has to already be about
 * the thing they are doing.
 */
export type TodayState = 'preShift' | 'activeLoad' | 'betweenLoads' | 'recovery';

export function todayState(input: {
  duty: Pick<DutyView, 'onDuty'>;
  currentLoad: Load | null;
  shiftFailed: boolean;
  driverFailed: boolean;
}): TodayState {
  // Recovery wins: a screen built on data that failed to load must say so before it says anything
  // else, and it must still show whatever the cache held.
  if (input.shiftFailed || input.driverFailed) return 'recovery';
  if (!input.duty.onDuty) return 'preShift';
  return input.currentLoad ? 'activeLoad' : 'betweenLoads';
}

/** Heights that keep a skeleton the same size as the module it stands in for. */
/**
 * May the hero show a skeleton instead of its card?
 *
 * A boolean this small does not look worth extracting until it is wrong, and this one was wrong in
 * two ways at once for every fleet with the Loads tab disabled (2026-09-07):
 *
 * - `isPending` is TRUE FOREVER for a disabled query. `useLoads(enabled)` passes `enabled: false`
 *   when `tab.loads` is off, and TanStack v5 reports that as pending-with-no-data — so the old
 *   `loads.isPending && !loads.data` never became false and those drivers saw a 332pt grey
 *   rectangle where the start-shift card belongs, permanently. `isLoading` is `isPending &&
 *   isFetching`, which a disabled query never satisfies. That distinction is the whole fix.
 * - The pre-shift card reads duty and equipment, never loads. Waiting on a loads request to draw a
 *   card that request cannot change is filler, and DESIGN.md is explicit that a region answering no
 *   driver question is removed.
 *
 * Living here rather than in the JSX is the point: `home.tsx` is composition only, and a rule that
 * can be silently wrong on a device belongs where a test can reach it.
 */
export function shouldSkeletonHero(input: {
  loadsEnabled: boolean;
  loadsLoading: boolean;
  state: TodayState;
}): boolean {
  if (!input.loadsEnabled) return false;
  if (input.state === 'preShift') return false;
  return input.loadsLoading;
}

/** The alert kinds Today can raise at once, in the order a driver should meet them. */
export type TodayAlert = 'recovery' | 'offline' | 'update';

/**
 * Which alerts are live, most urgent first.
 *
 * DESIGN.md: "Multiple simultaneous alerts collapse into one attention summary with expandable
 * detail." Today could stack three — an update offer, a connectivity strip and a recovery error —
 * as direct children of a `flow="sections"` screen, which gives them no gap either, so they abutted
 * one another and the first Section at zero spacing.
 *
 * The order is the argument. RECOVERY first: the app does not know the driver's duty status, and
 * every other line on the screen is suspect until it does. OFFLINE second: it changes what a driver
 * can expect of everything, and it is the normal state on a rural interstate rather than an error.
 * UPDATE last, always: it is an offer to restart at a convenient moment, and it is the one alert
 * that can wait for the other two to clear.
 */
export function todayAlerts(input: {
  recovery: boolean;
  offline: boolean;
  pendingSync: number;
  updateReady: boolean;
}): TodayAlert[] {
  const alerts: TodayAlert[] = [];
  if (input.recovery) alerts.push('recovery');
  // Mirrors OfflineBanner's own condition: it shows while offline OR while work is still draining.
  if (input.offline || input.pendingSync > 0) alerts.push('offline');
  if (input.updateReady) alerts.push('update');
  return alerts;
}

export const SKELETON_HEIGHTS = {
  // NOT measured against their modules, despite what this block used to claim: CurrentLoadHero is
  // ~392pt and StartDayCard ~320pt against `heroCard: 332`, and DutyStrip is ~46 against 56. The
  // jump is now rare rather than fixed — `shouldSkeletonHero` keeps the hero skeleton off the two
  // states that never needed it — but the numbers are approximations and this comment says so
  // rather than asserting a precision nobody checked.
  dutyStrip: 56,
  heroCard: 332,
  attentionRow: 64,
  upNextRow: 72,
  weekStrip: 84,
} as const;

export interface AttentionRow {
  key: string;
  tone: Tone;
  icon: MaterialSymbolName;
  title: string;
  subtitle: string;
  time?: string;
  /** A row with no destination is information, not a task: it renders without a chevron. */
  href?: string;
  /** Notification ids to mark read when this row is opened. */
  marksRead?: string[];
}

/** Four is the cap: a fifth row is a list, and a list is not attention. */
const MAX_ROWS = 4;

export function attentionRows(input: {
  sync: { pending: number; needsAttention: number };
  duty: Pick<DutyView, 'onDuty' | 'hasTrailer'>;
  currentLoad: Load | null;
  notifications: readonly NotificationEvent[];
  threads: readonly Thread[];
  hazmat: readonly MeHazmatLoadRow[];
  viewerId: string;
  now?: number;
}): AttentionRow[] {
  const now = input.now ?? Date.now();
  const rows: AttentionRow[] = [];

  // 1. Work that could not leave the phone. This outranks everything: it is the only item where the
  // driver's own completed work is at stake rather than work still ahead of them.
  if (input.sync.needsAttention > 0) {
    rows.push({
      key: 'sync-failed',
      tone: 'danger',
      icon: 'sync_problem',
      title: `${input.sync.needsAttention} ${plural(input.sync.needsAttention, 'item')} couldn't sync`,
      subtitle: 'Your work is safe · tap to retry',
      href: '/settings',
    });
  }

  // 2. A trailer gap on the load being worked: it blocks the next pickup, and it is fixable now.
  const current = input.currentLoad;
  if (current && input.duty.onDuty && !input.duty.hasTrailer && equipmentRequiresTrailer(current.equipment)) {
    const next = openStops(current)[0];
    rows.push({
      key: 'trailer-gap',
      tone: 'caution',
      icon: 'route',
      title: `${current.equipment ?? 'This load'} needs a trailer`,
      subtitle: `Add the one you're pulling before ${next?.kind === 'pickup' ? 'your pickup' : 'your delivery'}`,
      href: '/duty/check-in?mode=swap',
    });
  }

  // 3. Unread notifications that are not routine.
  const notifications = [...input.notifications]
    .filter((n) => n.read_at === null && n.severity !== 'info')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 2);
  for (const n of notifications) {
    rows.push({
      key: `notification-${n.id}`,
      tone: n.severity === 'critical' ? 'danger' : 'caution',
      icon: CATEGORY_ICON[n.category] ?? 'info',
      title: n.title,
      subtitle: n.body ?? '',
      time: timeLabel(n.created_at, now),
      href: n.deep_link ?? '/notifications',
      marksRead: [n.id],
    });
  }

  // 4. Unread threads. Dispatch asking a question is attention; dispatch's answer is not.
  const threads = [...input.threads]
    .filter((t) => t.unread > 0)
    .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at))
    .slice(0, 2);
  for (const t of threads) {
    rows.push({
      key: `thread-${t.id}`,
      tone: 'info',
      icon: 'mail',
      title: t.last_message?.sender_name ?? threadTitle(t, input.viewerId),
      subtitle: `“${messagePreview(t.last_message)}”`,
      time: timeLabel(t.last_message_at, now),
      href: `/messages/${t.id}`,
    });
  }

  // 5. Work still queued. Not a task — there is nothing for the driver to do — so it carries no
  // destination and no chevron. It is here because silence about queued work reads as data loss.
  if (input.sync.pending > 0) {
    rows.push({
      key: 'sync-pending',
      tone: 'action',
      icon: 'sync',
      title: `${input.sync.pending} ${plural(input.sync.pending, 'item')} waiting to sync`,
      subtitle: 'Saved on this phone · sends when you have signal',
    });
  }

  // 6. A hazmat verdict that went against the driver, while it is still actionable.
  const weekAgo = now - 7 * 86_400_000;
  const hazmat = [...input.hazmat]
    .filter((h) => (h.latest_outcome === 'rejected' || h.latest_outcome === 'needs_review')
      && Date.parse(h.created_at) >= weekAgo)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 1);
  for (const h of hazmat) {
    rows.push({
      key: `hazmat-${h.id}`,
      tone: h.latest_outcome === 'rejected' ? 'danger' : 'caution',
      icon: 'local_fire_department',
      title: `BOL check ${h.latest_outcome === 'rejected' ? 'rejected' : 'in review'}`,
      subtitle: rowDate(h.created_at),
      href: `/hazmat/${h.id}`,
    });
  }

  if (rows.length <= MAX_ROWS) return rows;
  // Everything past the cap collapses into one honest row rather than being silently dropped.
  const kept = rows.slice(0, MAX_ROWS - 1);
  kept.push({
    key: 'more',
    tone: 'neutral',
    icon: 'more_horiz',
    title: `${rows.length - kept.length} more`,
    subtitle: 'Open your notifications',
    href: '/notifications',
  });
  return kept;
}

/** Offered before accepted, then soonest first — an offer expires, an assignment does not. */
export function upNextLoads(upcoming: readonly Load[], limit: number): Load[] {
  return [...upcoming]
    .sort((a, b) => {
      const offer = Number(b.status === 'offered') - Number(a.status === 'offered');
      if (offer !== 0) return offer;
      return (firstAppointment(a) ?? '').localeCompare(firstAppointment(b) ?? '');
    })
    .slice(0, limit);
}

/**
 * How long until the driver can work this stop, in the words they would use.
 *
 * `Stop n of m` and this countdown are the two facts the hero can honestly show. Remaining distance
 * and ETA are NOT among them: `total_miles` is the whole load, and no routing service is reachable
 * from this app (D-DB8 / Q-DB3), so any "148 mi ahead" would be invented.
 */
export function countdownLabel(
  stop: { appointment_start: string | null; appointment_end: string | null },
  now: number = Date.now(),
): { text: string; tone: 'neutral' | 'warning' } | null {
  const start = stop.appointment_start ? Date.parse(stop.appointment_start) : NaN;
  const end = stop.appointment_end ? Date.parse(stop.appointment_end) : NaN;
  if (!Number.isFinite(start)) return null;

  const minutes = Math.round((start - now) / 60_000);
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    return { text: `Opens in ${h} h ${minutes % 60} min`, tone: 'neutral' };
  }
  if (minutes >= 1) return { text: `Opens in ${minutes} min`, tone: 'neutral' };
  if (Number.isFinite(end) && now > end) return { text: 'Window closed', tone: 'warning' };
  return { text: 'Window open now', tone: 'neutral' };
}

// ── small shared helpers ─────────────────────────────────────────────────────
function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

function openStops(load: Load) {
  return load.stops
    .filter((s) => s.status !== 'completed' && s.status !== 'skipped')
    .sort((a, b) => a.seq - b.seq);
}

function firstAppointment(load: Load): string | null {
  const ordered = [...load.stops].sort((a, b) => a.seq - b.seq);
  return ordered[0]?.appointment_start ?? null;
}

/** Time today, date before that — the same rule the notification centre uses. */
export function timeLabel(iso: string, now: number = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = new Date(now).toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function rowDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
