import { describe, expect, it } from 'vitest';
import type { Load, LoadStop, MeHazmatLoadRow, NotificationEvent, Thread } from '@silvicom/shared';
import { attentionRows, countdownLabel, shouldSkeletonHero, todayAlerts, todayState, upNextLoads } from '@/screens/today/todayModel';

const NOW = Date.parse('2026-09-07T12:00:00Z');

function stop(over: Partial<LoadStop> = {}): LoadStop {
  return {
    id: `00000000-0000-4000-8000-${String(over.seq ?? 1).padStart(12, '0')}`,
    seq: 1, kind: 'dropoff', name: 'Effingham DC', address_line: '1204 W Fayette Ave',
    city: 'Effingham', state: 'IL', postal_code: '62401', lat: null, lon: null,
    appointment_start: '2026-09-07T14:00:00Z', appointment_end: '2026-09-07T16:00:00Z',
    status: 'pending', arrived_at: null, completed_at: null, required_photos: [],
    skip_reason: null, notes: null, photos: [], ...over,
  };
}

function load(over: Partial<Load> = {}): Load {
  return {
    id: '11111111-1111-4111-8111-111111111111', ref: 'LD-20481', status: 'in_transit',
    equipment: 'Dry van', commodity: null, hazmat: false, total_miles: 412, accepted_at: null,
    completed_at: null, notes: null, created_at: '2026-09-06T08:00:00Z', vehicle_unit: '4471',
    trailer_unit: null, stops: [stop()], ...over,
  };
}

const NO_SYNC = { pending: 0, needsAttention: 0 };
const OFF_DUTY = { onDuty: false, hasTrailer: false };
const ON_DUTY = { onDuty: true, hasTrailer: true };

function rows(over: Partial<Parameters<typeof attentionRows>[0]> = {}) {
  return attentionRows({
    sync: NO_SYNC, duty: ON_DUTY, currentLoad: null, notifications: [], threads: [],
    hazmat: [], viewerId: 'me', now: NOW, ...over,
  });
}

describe('todayState', () => {
  it('is preShift before the driver goes on duty', () => {
    expect(todayState({ duty: OFF_DUTY, currentLoad: null, shiftFailed: false, driverFailed: false })).toBe('preShift');
  });

  it('is activeLoad only when a load is actually being worked', () => {
    expect(todayState({ duty: ON_DUTY, currentLoad: load(), shiftFailed: false, driverFailed: false })).toBe('activeLoad');
    expect(todayState({ duty: ON_DUTY, currentLoad: null, shiftFailed: false, driverFailed: false })).toBe('betweenLoads');
  });

  it('recovery outranks every other state, including a load in the cache', () => {
    // A screen built on data that failed to load has to say so first — but it still shows the
    // cached load underneath, which is why recovery is a STATE and not an early return.
    expect(todayState({ duty: ON_DUTY, currentLoad: load(), shiftFailed: true, driverFailed: false })).toBe('recovery');
    expect(todayState({ duty: OFF_DUTY, currentLoad: null, shiftFailed: false, driverFailed: true })).toBe('recovery');
  });
});

describe('attentionRows', () => {
  it('renders nothing when there is nothing to attend to', () => {
    expect(rows()).toEqual([]);
  });

  it('puts work that could not leave the phone above everything else', () => {
    const out = rows({
      sync: { pending: 3, needsAttention: 2 },
      notifications: [notification({ severity: 'critical' })],
    });
    expect(out[0]?.key).toBe('sync-failed');
    expect(out[0]?.title).toBe("2 items couldn't sync");
    // Queued work is information, not a task: no destination, so the row draws no chevron.
    expect(out.find((r) => r.key === 'sync-pending')?.href).toBeUndefined();
  });

  it('singularises the sync counts', () => {
    const out = rows({ sync: { pending: 1, needsAttention: 1 } });
    expect(out[0]?.title).toBe("1 item couldn't sync");
    expect(out[1]?.title).toBe('1 item waiting to sync');
  });

  it('raises a trailer gap only when the load actually needs one', () => {
    const gap = { duty: { onDuty: true, hasTrailer: false }, currentLoad: load({ equipment: 'Dry van' }) };
    expect(rows(gap).map((r) => r.key)).toContain('trailer-gap');
    // Bobtail and power-only equipment do not need a trailer, so the row would be a false alarm.
    expect(rows({ ...gap, currentLoad: load({ equipment: 'Bobtail' }) }).map((r) => r.key)).not.toContain('trailer-gap');
    // Off duty there is no trailer to be missing yet.
    expect(rows({ ...gap, duty: OFF_DUTY }).map((r) => r.key)).not.toContain('trailer-gap');
  });

  it('ignores routine notifications and already-read ones', () => {
    const out = rows({
      notifications: [
        notification({ id: idOf(1), severity: 'info', title: 'Weekly score ready' }),
        notification({ id: idOf(2), severity: 'critical', title: 'Load canceled', read_at: '2026-09-07T11:00:00Z' }),
        notification({ id: idOf(3), severity: 'warning', title: 'Appointment moved' }),
      ],
    });
    expect(out.map((r) => r.title)).toEqual(['Appointment moved']);
  });

  it('takes the two newest notifications and marks them read on open', () => {
    const out = rows({
      notifications: [
        notification({ id: idOf(1), severity: 'warning', title: 'Oldest', created_at: '2026-09-07T08:00:00Z' }),
        notification({ id: idOf(2), severity: 'warning', title: 'Newest', created_at: '2026-09-07T11:00:00Z' }),
        notification({ id: idOf(3), severity: 'warning', title: 'Middle', created_at: '2026-09-07T10:00:00Z' }),
      ],
    });
    expect(out.map((r) => r.title)).toEqual(['Newest', 'Middle']);
    expect(out[0]?.marksRead).toEqual([idOf(2)]);
  });

  it('names the sender on a thread row, not the thread', () => {
    const out = rows({ threads: [thread({ senderName: 'Maria' })] });
    expect(out[0]?.title).toBe('Maria');
    expect(out[0]?.subtitle).toBe('“Are you loaded yet?”');
  });

  it('falls back to the thread title when the last message has no sender name', () => {
    const out = rows({ threads: [thread({ senderName: null })] });
    expect(out[0]?.title).toBe('Load LD-20481');
  });

  it('shows a hazmat verdict that went against the driver, but only while it is fresh', () => {
    const fresh = hazmatRow({ created_at: '2026-09-05T09:00:00Z', latest_outcome: 'rejected' });
    const stale = hazmatRow({ created_at: '2026-08-01T09:00:00Z', latest_outcome: 'rejected' });
    const cleared = hazmatRow({ created_at: '2026-09-05T09:00:00Z', latest_outcome: 'cleared' });
    expect(rows({ hazmat: [fresh] })[0]?.title).toBe('BOL check rejected');
    expect(rows({ hazmat: [stale] })).toEqual([]);
    expect(rows({ hazmat: [cleared] })).toEqual([]);
  });

  it('collapses everything past four rows into one honest "+n more"', () => {
    const out = rows({
      sync: { pending: 2, needsAttention: 1 },
      duty: { onDuty: true, hasTrailer: false },
      currentLoad: load({ equipment: 'Dry van' }),
      notifications: [
        notification({ id: idOf(1), severity: 'warning', title: 'One' }),
        notification({ id: idOf(2), severity: 'warning', title: 'Two' }),
      ],
      threads: [thread({ senderName: 'Maria' })],
    });
    expect(out).toHaveLength(4);
    expect(out[3]?.key).toBe('more');
    expect(out[3]?.title).toBe('3 more');
    expect(out[3]?.href).toBe('/notifications');
  });
});

describe('upNextLoads', () => {
  it('puts offers before assignments, then soonest first', () => {
    const offered = load({ id: idOf(9), status: 'offered', stops: [stop({ appointment_start: '2026-09-09T09:00:00Z' })] });
    const soon = load({ id: idOf(7), status: 'accepted', stops: [stop({ appointment_start: '2026-09-08T06:00:00Z' })] });
    const later = load({ id: idOf(8), status: 'accepted', stops: [stop({ appointment_start: '2026-09-08T18:00:00Z' })] });
    // An offer expires and an assignment does not, so the offer leads even though it is two days out.
    expect(upNextLoads([soon, later, offered], 3).map((l) => l.id)).toEqual([idOf(9), idOf(7), idOf(8)]);
    expect(upNextLoads([soon, later, offered], 1).map((l) => l.id)).toEqual([idOf(9)]);
  });
});

describe('countdownLabel', () => {
  const window = { appointment_start: '2026-09-07T14:10:00Z', appointment_end: '2026-09-07T16:00:00Z' };

  it('says hours and minutes past an hour out', () => {
    expect(countdownLabel(window, NOW)).toEqual({ text: 'Opens in 2 h 10 min', tone: 'neutral' });
  });

  it('drops to minutes inside the hour', () => {
    expect(countdownLabel(window, Date.parse('2026-09-07T13:25:00Z'))).toEqual({ text: 'Opens in 45 min', tone: 'neutral' });
  });

  it('says the window is open once it has started', () => {
    expect(countdownLabel(window, Date.parse('2026-09-07T14:15:00Z'))).toEqual({ text: 'Window open now', tone: 'neutral' });
  });

  it('flips to "open now" AT the appointment, never counting down to zero', () => {
    // The boundary, because "Opens in 0 min" is the wrong sentence for a window that is open.
    expect(countdownLabel(window, Date.parse('2026-09-07T14:10:00Z'))).toEqual({ text: 'Window open now', tone: 'neutral' });
    expect(countdownLabel(window, Date.parse('2026-09-07T14:09:00Z'))).toEqual({ text: 'Opens in 1 min', tone: 'neutral' });
  });

  it('warns once the window has closed, which is the only state that is bad news', () => {
    expect(countdownLabel(window, Date.parse('2026-09-07T16:30:00Z'))).toEqual({ text: 'Window closed', tone: 'warning' });
  });

  it('is null with no appointment rather than inventing one', () => {
    expect(countdownLabel({ appointment_start: null, appointment_end: null }, NOW)).toBeNull();
  });
});

// ── fixtures ─────────────────────────────────────────────────────────────────
function idOf(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function notification(over: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    id: idOf(1), category: 'load_changed', title: 'Appointment moved', body: 'Stop 2 is now 15:00',
    severity: 'warning', entity_type: null, entity_id: null, deep_link: null,
    created_at: '2026-09-07T11:30:00Z', read_at: null, ...over,
  };
}

function thread({ senderName }: { senderName: string | null }): Thread {
  return {
    id: idOf(5), subject: null, load_id: null, load_ref: 'LD-20481', created_at: '2026-09-07T09:00:00Z',
    last_message_at: '2026-09-07T11:45:00Z', participants: [], unread: 2, status: 'open',
    last_message: {
      id: idOf(6), thread_id: idOf(5), sender_user_id: 'dispatch', sender_name: senderName,
      body: 'Are you loaded yet?', created_at: '2026-09-07T11:45:00Z', edited_at: null, deleted_at: null,
    },
  };
}

function hazmatRow(over: Partial<MeHazmatLoadRow> = {}): MeHazmatLoadRow {
  return { id: idOf(3), status: 'complete', created_at: '2026-09-06T09:00:00Z', latest_outcome: 'rejected', ...over };
}

describe('shouldSkeletonHero', () => {
  /**
   * The bug this replaces: `loads.isPending && !loads.data` was true FOREVER for a fleet with the
   * Loads tab off, because a disabled TanStack query never leaves `pending`. Those drivers saw a
   * 332pt grey rectangle where the start-shift card belongs, on every launch. Found by running the
   * app, not by any gate — the condition lived in JSX where no test could reach it.
   */
  it('never skeletons when the fleet has loads disabled, however the query reports itself', () => {
    // The exact shape of the shipped bug: a disabled query reports `isLoading` false but `isPending`
    // true forever, and the old condition read the second.
    expect(shouldSkeletonHero({ loadsEnabled: false, loadsLoading: true, state: 'preShift' })).toBe(false);
    expect(shouldSkeletonHero({ loadsEnabled: false, loadsLoading: true, state: 'activeLoad' })).toBe(false);
  });

  it('never skeletons the pre-shift card, which reads no loads at all', () => {
    expect(shouldSkeletonHero({ loadsEnabled: true, loadsLoading: true, state: 'preShift' })).toBe(false);
  });

  it('does skeleton the states where a load decides the card', () => {
    for (const state of ['activeLoad', 'betweenLoads'] as const) {
      expect(shouldSkeletonHero({ loadsEnabled: true, loadsLoading: true, state })).toBe(true);
    }
  });

  it('stops as soon as the fetch finishes', () => {
    expect(shouldSkeletonHero({ loadsEnabled: true, loadsLoading: false, state: 'activeLoad' })).toBe(false);
  });

  it('shows no skeleton in recovery — the error is the content', () => {
    expect(shouldSkeletonHero({ loadsEnabled: true, loadsLoading: false, state: 'recovery' })).toBe(false);
  });
});

describe('todayAlerts', () => {
  /**
   * DESIGN.md asks for "one attention summary with expandable detail"; Today could render three
   * banners at once, as direct children of a `flow="sections"` screen, which gives them no gap.
   */
  it('is empty when nothing is wrong — the common case', () => {
    expect(todayAlerts({ recovery: false, offline: false, pendingSync: 0, updateReady: false })).toEqual([]);
  });

  it('puts recovery first: every other line is suspect until duty is known', () => {
    expect(
      todayAlerts({ recovery: true, offline: true, pendingSync: 3, updateReady: true }),
    ).toEqual(['recovery', 'offline', 'update']);
  });

  it('puts the update offer last even when it is the only other thing', () => {
    expect(todayAlerts({ recovery: false, offline: true, pendingSync: 0, updateReady: true })).toEqual([
      'offline',
      'update',
    ]);
  });

  it('raises the connectivity alert while work is still draining, though online', () => {
    // Matches OfflineBanner's own condition; a driver back in signal with unsent work is not "fine".
    expect(todayAlerts({ recovery: false, offline: false, pendingSync: 2, updateReady: false })).toEqual([
      'offline',
    ]);
  });

  it('stays quiet when online with nothing queued', () => {
    expect(todayAlerts({ recovery: false, offline: false, pendingSync: 0, updateReady: true })).toEqual([
      'update',
    ]);
  });
});

describe('todayAlerts', () => {
  it('is empty when nothing is wrong — the common case', () => {
    expect(todayAlerts({ recovery: false, offline: false, pendingSync: 0, updateReady: false })).toEqual([]);
  });

  it('puts recovery first: every other line is suspect until duty is known', () => {
    expect(todayAlerts({ recovery: true, offline: true, pendingSync: 3, updateReady: true })).toEqual([
      'recovery',
      'offline',
      'update',
    ]);
  });

  it('puts the update offer last even when it is the only other thing', () => {
    expect(todayAlerts({ recovery: false, offline: true, pendingSync: 0, updateReady: true })).toEqual([
      'offline',
      'update',
    ]);
  });

  it('raises the connectivity alert while work is still draining, though online', () => {
    // Mirrors OfflineBanner's own condition; a driver back in signal with unsent work is not "fine".
    expect(todayAlerts({ recovery: false, offline: false, pendingSync: 2, updateReady: false })).toEqual([
      'offline',
    ]);
  });

  it('stays quiet about connectivity when online with nothing queued', () => {
    expect(todayAlerts({ recovery: false, offline: false, pendingSync: 0, updateReady: true })).toEqual([
      'update',
    ]);
  });
});
