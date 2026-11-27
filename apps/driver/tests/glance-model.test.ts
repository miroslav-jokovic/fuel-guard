import { describe, expect, it } from 'vitest';
import type { Load, LoadStop } from '@silvicom/shared';
import {
  activityCommand,
  GLANCE_COLORS,
  glanceProps,
  glanceStaleAt,
  glanceStopLoad,
  glanceTimeline,
  idleProps,
} from '@/features/glance/glanceModel';
import { activeLoadStatus, clock } from '@/screens/today/todayStatusModel';
import { countdownLabel } from '@/screens/today/todayModel';

// Local-time ISO strings, as in today-status-model.test.ts, so "today" is the same day everywhere.
const NOW = new Date(2026, 10, 20, 5, 42).getTime();
const at = (h: number, m = 0) => new Date(2026, 10, 20, h, m).toISOString();
const ms = (h: number, m = 0) => new Date(2026, 10, 20, h, m).getTime();

function stop(over: Partial<LoadStop> = {}): LoadStop {
  const seq = over.seq ?? 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, seq, kind: 'pickup', name: 'Ardent Mills',
    address_line: null, city: 'Chicago', state: 'IL', postal_code: null, lat: null, lon: null,
    appointment_start: at(6), appointment_end: at(8), status: 'pending', arrived_at: null, completed_at: null,
    required_photos: [], skip_reason: null, notes: null, photos: [], external_status: null, actual_arrival_at: null, actual_departure_at: null, mcleod_removed_at: null, ...over,
  };
}

function load(over: Partial<Load> = {}): Load {
  return {
    id: '11111111-1111-4111-8111-111111111111', ref: '1184530', status: 'in_transit',
    equipment: 'Dry van', commodity: null, hazmat: false, total_miles: 183, accepted_at: null,
    completed_at: null, notes: null, created_at: at(0), vehicle_unit: '2241', trailer_unit: '53118', source: 'manual', acknowledged_at: null, customer_name: null,
    stops: [stop(), stop({ seq: 2, kind: 'dropoff', name: 'Kroger DC', city: 'Indianapolis', state: 'IN', appointment_start: at(14), appointment_end: at(16) })],
    ...over,
  };
}

describe('glanceStopLoad — the glance shows a stop only while one is being driven to', () => {
  it('is the current load when on duty with an open stop', () => {
    const l = load();
    expect(glanceStopLoad({ onDuty: true, currentLoad: l })).toBe(l);
  });

  it('is null off duty, with no load, or when every stop is done', () => {
    expect(glanceStopLoad({ onDuty: false, currentLoad: load() })).toBeNull();
    expect(glanceStopLoad({ onDuty: true, currentLoad: null })).toBeNull();
    const done = load({ stops: [stop({ status: 'completed' })] });
    expect(glanceStopLoad({ onDuty: true, currentLoad: done })).toBeNull();
  });
});

describe('glanceProps — the same words as Today, laid out for the lock screen', () => {
  it("takes the context, stop and place from Today's status block", () => {
    const props = glanceProps(load(), NOW);
    const block = activeLoadStatus(load(), NOW);
    expect(props.mode).toBe('stop');
    expect(props.context).toBe(block.context);
    expect(props.title).toBe('Ardent Mills');
    expect(props.place).toBe('Chicago, IL');
    expect(props.window).toBe([block.figure, block.figureSuffix].join(' '));
  });

  it('counts down to the window opening, and stops counting once it is open', () => {
    expect(glanceProps(load(), NOW)).toMatchObject({ line: '', countdownTo: ms(6), lineTone: 'live' });
    expect(glanceProps(load(), ms(7))).toMatchObject({ line: 'Window open now' });
    expect('countdownTo' in glanceProps(load(), ms(7))).toBe(false);
  });

  it("captions the running timer with the start of Today's own countdown sentence", () => {
    const props = glanceProps(load(), NOW);
    expect(countdownLabel(load().stops[0]!, NOW)?.text.startsWith(props.countdownCaption)).toBe(true);
    expect(props.countdownCaption).not.toBe('');
    expect(props.at).toBe(clock(at(6)));
    expect(glanceProps(load(), ms(7)).countdownCaption).toBe('');
  });

  it('says a closed window in amber, never as a timer counting up', () => {
    expect(glanceProps(load(), ms(9))).toMatchObject({ line: 'Window closed', lineTone: 'act' });
    expect('countdownTo' in glanceProps(load(), ms(9))).toBe(false);
  });

  it('opens the stop screen when tapped', () => {
    const l = load();
    expect(glanceProps(l, NOW).url).toBe(`fuelguard://loads/${l.id}/stop/${l.stops[0]!.id}`);
  });

  it('follows the run: with the pickup done, the delivery is the stop', () => {
    const l = load({ stops: [stop({ status: 'completed' }), load().stops[1]!] });
    expect(glanceProps(l, NOW)).toMatchObject({ title: 'Kroger DC', place: 'Indianapolis, IN' });
  });

  it("paints with the role theme's hero colours, as hex the widget runtime can read", () => {
    expect(glanceProps(load(), NOW).colors).toBe(GLANCE_COLORS);
    for (const value of Object.values(GLANCE_COLORS)) expect(value).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe('the props cross into native code', () => {
  it('carry no null anywhere, in every phase and when idle (a Swift dictionary cannot hold one)', () => {
    const hasNull = (value: unknown): boolean =>
      value === null || (typeof value === 'object' && Object.values(value).some(hasNull));
    for (const entry of [...glanceTimeline(load(), NOW, true), ...glanceTimeline(null, NOW, false)]) {
      expect(hasNull(entry.props), JSON.stringify(entry.props)).toBe(false);
    }
  });
});

describe('glanceTimeline — the lock screen changes phase with the app asleep', () => {
  it('has an entry now, when the window opens, and just after it closes', () => {
    const entries = glanceTimeline(load(), NOW, true);
    expect(entries.map((e) => e.at)).toEqual([NOW, ms(6), ms(8) + 1]);
    expect(entries.map((e) => e.props.line)).toEqual(['', 'Window open now', 'Window closed']);
    expect(entries[0]!.props.countdownTo).toBe(ms(6));
  });

  it('drops phases already past', () => {
    expect(glanceTimeline(load(), ms(7), true).map((e) => e.at)).toEqual([ms(7), ms(8) + 1]);
  });

  it('has one idle entry when no stop is being driven to', () => {
    expect(glanceTimeline(null, NOW, false)).toEqual([{ at: NOW, props: idleProps('Off duty') }]);
    expect(glanceTimeline(null, NOW, true)[0]!.props.context).toBe('On duty');
  });

  it('a close-only window has no phase to change to', () => {
    const l = load({ stops: [stop({ appointment_start: null, appointment_end: at(16) })] });
    expect(glanceTimeline(l, NOW, true)).toHaveLength(1);
    expect(glanceStaleAt(l, NOW)).toBeNull();
  });
});

describe('activityCommand — one Live Activity while a stop is driven to, none otherwise', () => {
  it('starts one for a stop, stale when the window opens', () => {
    expect(activityCommand({ running: false, shown: null, load: load(), now: NOW })).toEqual({
      kind: 'start', props: glanceProps(load(), NOW), staleAt: ms(6),
    });
  });

  it('does not update when nothing it shows changed, a minute later included', () => {
    const shown = glanceProps(load(), NOW);
    expect(activityCommand({ running: true, shown, load: load(), now: NOW })).toEqual({ kind: 'none' });
    expect(activityCommand({ running: true, shown, load: load(), now: NOW + 60_000 })).toEqual({ kind: 'none' });
  });

  it('updates when the stop or its phase changed', () => {
    const shown = glanceProps(load(), NOW);
    expect(activityCommand({ running: true, shown, load: load(), now: ms(7) }).kind).toBe('update');
  });

  it('ends it when there is no stop, and does nothing when none runs', () => {
    expect(activityCommand({ running: true, shown: null, load: null, now: NOW })).toEqual({ kind: 'end' });
    expect(activityCommand({ running: false, shown: null, load: null, now: NOW })).toEqual({ kind: 'none' });
  });
});
