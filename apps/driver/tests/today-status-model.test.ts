import { describe, expect, it } from 'vitest';
import type { Load, LoadStop } from '@silvicom/shared';
import {
  activeLoadStatus,
  activeNextStep,
  betweenLoadsNextStep,
  betweenLoadsStatus,
  clock,
  dayWord,
  heroClock,
  splitDayPeriod,
  doneTodayRows,
  preShiftStatus,
  remainingStopRows,
  rigRow,
  rigTitle,
  startRigRow,
  upcomingLoadRows,
} from '@/screens/today/todayStatusModel';

// Local-time ISO strings, so "today" in the model and in these fixtures is the same calendar day
// wherever the suite runs.
const NOW = new Date(2026, 10, 20, 5, 42).getTime();
const at = (h: number, m = 0, dayOffset = 0) => new Date(2026, 10, 20 + dayOffset, h, m).toISOString();

function stop(over: Partial<LoadStop> = {}): LoadStop {
  const seq = over.seq ?? 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    seq, kind: 'pickup', name: 'Ardent Mills', address_line: null,
    city: 'Chicago', state: 'IL', postal_code: null, lat: null, lon: null,
    appointment_start: at(6), appointment_end: at(8),
    status: 'pending', arrived_at: null, completed_at: null, required_photos: [],
    skip_reason: null, notes: null, photos: [], external_status: null, actual_arrival_at: null, actual_departure_at: null, mcleod_removed_at: null, ...over,
  };
}

const delivery = (over: Partial<LoadStop> = {}) => stop({
  seq: 2, kind: 'dropoff', name: 'Kroger DC', city: 'Indianapolis', state: 'IN',
  appointment_start: at(14), appointment_end: at(16), ...over,
});

function load(over: Partial<Load> = {}): Load {
  return {
    id: '11111111-1111-4111-8111-111111111111', ref: '1184530', status: 'in_transit',
    equipment: 'Dry van', commodity: null, hazmat: false, total_miles: 183, accepted_at: null,
    completed_at: null, notes: null, created_at: at(0), vehicle_unit: '2241',
    trailer_unit: '53118', source: 'manual', acknowledged_at: null, customer_name: null, stops: [stop(), delivery()], ...over,
  };
}

/** What the block's figure and suffix are on this machine's clock format, 12- or 24-hour. */
function hero(iso: string, tail?: string) {
  const { time, period } = heroClock(iso);
  const suffix = [period, tail].filter(Boolean).join(' ');
  return { figure: time, ...(suffix ? { figureSuffix: suffix } : {}) };
}

const photo = (slot: string) => ({
  id: `p-${slot}`, slot, storage_path: `x/${slot}.webp`, captured_at: null, uploaded_at: at(5),
});

describe('activeLoadStatus (the mock screen 1 block)', () => {
  it('names the next stop, its place in the run, the window and a countdown to it', () => {
    expect(activeLoadStatus(load(), NOW)).toEqual({
      context: 'Pickup · stop 1 of 2 · Load 1184530',
      subject: 'Ardent Mills',
      place: 'Chicago, IL',
      ...hero(at(6), `– ${clock(at(8))}`),
      live: 'Window opens in 18 min',
      liveTone: 'live',
    });
  });

  it('moves to the delivery once the pickup is finished (mock screen 3)', () => {
    const view = activeLoadStatus(
      load({ stops: [stop({ status: 'completed', completed_at: at(7, 12) }), delivery()] }),
      new Date(2026, 10, 20, 13, 20).getTime(),
    );
    expect(view.context).toBe('Delivery · stop 2 of 2 · Load 1184530');
    expect(view.subject).toBe('Kroger DC');
    expect(view.live).toBe('Window opens in 40 min');
  });

  it('says a closed window in amber, and never says "Tight" (Q-DV4)', () => {
    const view = activeLoadStatus(load(), new Date(2026, 10, 20, 9, 0).getTime());
    expect(view.live).toBe('Window closed');
    expect(view.liveTone).toBe('act');
    expect(JSON.stringify(view)).not.toMatch(/tight/i);
  });

  it('shows no figure and says so when the stop has no appointment, rather than inventing one', () => {
    const view = activeLoadStatus(load({ stops: [stop({ appointment_start: null, appointment_end: null })] }), NOW);
    expect(view.figure).toBeUndefined();
    expect(view.live).toBe('No appointment time');
  });

  it('carries no ETA and no miles (D-DV13), even though the load has total_miles', () => {
    expect(JSON.stringify(activeLoadStatus(load(), NOW))).not.toMatch(/\bmi\b|miles|ETA/);
  });

  it('says the run is done when every stop is finished', () => {
    const view = activeLoadStatus(load({ stops: [stop({ status: 'completed' }), delivery({ status: 'skipped' })] }), NOW);
    expect(view.subject).toBe('All stops done');
    expect(view.figure).toBeUndefined();
  });
});

describe('activeNextStep', () => {
  it('a pending stop: arrival is next, with the photos that follow it, as a real "arrived" update', () => {
    const step = activeNextStep(load({ stops: [stop({ required_photos: ['bol', 'seal'] }), delivery()] }));
    expect(step).toEqual({
      title: 'Arrive at pickup',
      reason: 'Then the BOL and seal photos',
      actionLabel: 'Arrived',
      action: { kind: 'arrive', loadId: load().id, stopId: stop().id },
    });
  });

  it('arrived with photos missing: names only the missing ones and opens the stop', () => {
    const step = activeNextStep(load({
      stops: [stop({ status: 'arrived', required_photos: ['bol', 'seal'], photos: [photo('bol')] }), delivery()],
    }));
    expect(step?.title).toBe('Take the seal photo');
    expect(step?.action).toEqual({ kind: 'openStop', loadId: load().id, stopId: stop().id });
  });

  it('arrived with every photo: finishing opens the stop, where D21 lives', () => {
    const step = activeNextStep(load({
      stops: [stop({ status: 'arrived', required_photos: ['bol'], photos: [photo('bol')] }), delivery()],
    }));
    expect(step?.title).toBe('Finish the pickup');
    expect(step?.reason).toBe('Every photo is taken');
    expect(step?.action.kind).toBe('openStop');
  });

  it('never offers to add a photo to a FINISHED stop, which the server refuses (Q-DV7)', () => {
    const step = activeNextStep(load({
      stops: [stop({ status: 'completed', completed_at: at(7), required_photos: ['seal'] }), delivery()],
    }));
    expect(step?.title).toBe('Arrive at delivery');
    expect(step?.action).toEqual({ kind: 'arrive', loadId: load().id, stopId: delivery().id });
  });

  it('is absent when nothing is left to do', () => {
    expect(activeNextStep(load({ stops: [stop({ status: 'completed' })] }))).toBeNull();
  });
});

describe('preShiftStatus (mock screen 9)', () => {
  it('off duty in the remembered truck, with the first appointment as the one figure', () => {
    expect(preShiftStatus({ unit: '2241', firstLoad: load({ status: 'accepted' }), now: NOW })).toEqual({
      context: 'Off duty · Unit 2241',
      ...hero(at(6)),
      live: 'First appointment · Ardent Mills, Chicago',
      liveTone: 'live',
    });
  });

  it('says which day when the first appointment is not today', () => {
    const tomorrow = load({ stops: [stop({ appointment_start: at(6, 0, 1) })] });
    expect(preShiftStatus({ unit: null, firstLoad: tomorrow, now: NOW }).live).toBe('First appointment tomorrow · Ardent Mills, Chicago');
  });

  it('promises no load to a fleet with the Loads tab off', () => {
    expect(preShiftStatus({ unit: '2241', firstLoad: null, loadsEnabled: false })).toEqual({
      context: 'Off duty · Unit 2241', subject: 'Start your shift when you are ready', liveTone: 'live',
    });
    expect(betweenLoadsStatus({ elapsed: '1h 05m', unit: null, nextLoad: null, loadsEnabled: false }).subject).toBe('Your shift is running');
  });

  it('with no load: plain "Off duty" and no figure', () => {
    const view = preShiftStatus({ unit: null, firstLoad: null, now: NOW });
    expect(view.context).toBe('Off duty');
    expect(view.subject).toBe('No load assigned yet');
    expect(view.figure).toBeUndefined();
  });
});

describe('betweenLoads', () => {
  it('shows the next load\'s first stop and window when one is assigned', () => {
    const view = betweenLoadsStatus({ elapsed: '2h 10m', unit: '2241', nextLoad: load({ status: 'accepted' }), now: NOW });
    expect(view.context).toBe('Next load · 1184530');
    expect(view.subject).toBe('Ardent Mills');
    expect(view.place).toBe('Chicago, IL · pickup');
    expect(view.live).toBe('Window opens in 18 min');
  });

  it('says nothing is in progress when nothing is assigned, with no next step', () => {
    expect(betweenLoadsStatus({ elapsed: null, unit: null, nextLoad: null }).subject).toBe('No load in progress');
    expect(betweenLoadsNextStep(null)).toBeNull();
  });

  it('an offer asks for a review; an accepted load opens', () => {
    expect(betweenLoadsNextStep(load({ status: 'offered' }))).toMatchObject({
      title: 'A load is offered to you', actionLabel: 'Review', reason: 'Load 1184530 · Chicago → Indianapolis',
    });
    expect(betweenLoadsNextStep(load({ status: 'accepted' }))?.actionLabel).toBe('Open');
  });
});

describe('rows', () => {
  it('rest of the day: the open stops after the one in the block, never the block\'s own stop', () => {
    const rows = remainingStopRows(load());
    expect(rows.map((r) => r.title)).toEqual(['Kroger DC']);
    expect(rows[0]).toMatchObject({ icon: 'south', subtitle: 'Indianapolis, IN · delivery', figureNote: `– ${clock(at(16))}` });
  });

  it('an offered load says "Offered" in cyan instead of a time', () => {
    const [row] = upcomingLoadRows([load({ status: 'offered' })], NOW);
    expect(row?.word).toEqual({ text: 'Offered', tone: 'live' });
    expect(row?.figure).toBeUndefined();
  });

  it('an accepted load shows its first appointment and the day it falls on', () => {
    const [row] = upcomingLoadRows([load({ status: 'accepted', stops: [stop({ appointment_start: at(6, 0, 1) }), delivery()] })], NOW);
    expect(row).toMatchObject({ title: 'Chicago → Indianapolis', figure: clock(at(6, 0, 1)), figureNote: 'tomorrow' });
  });

  it('done today: a finished stop with a missing photo offers "Add photo" and opens the stop (D-DV30)', () => {
    const current = load({ stops: [stop({ status: 'completed', completed_at: at(7, 12), required_photos: ['seal'] }), delivery()] });
    const rows = doneTodayRows({ current, previous: [], now: NOW });
    expect(rows).toEqual([{
      key: `done-${stop().id}`, icon: 'warning', tone: 'caution', title: 'Ardent Mills',
      subtitle: 'Chicago, IL · pickup · Seal photo missing',
      word: { text: 'Add photo', tone: 'secondary' }, href: `/loads/${current.id}/stop/${stop().id}`,
    }]);
  });

  it('done today: a skipped stop stays a record with no destination, whatever it lacks', () => {
    const rows = doneTodayRows({
      current: load({ stops: [stop({ status: 'skipped', completed_at: at(7, 12), required_photos: ['seal'] }), delivery()] }),
      previous: [],
      now: NOW,
    });
    expect(rows[0]).toMatchObject({ figure: clock(at(7, 12)), figureNote: 'skipped' });
    expect(rows[0]?.href).toBeUndefined();
  });

  it('done today: only today\'s work, and loads delivered today', () => {
    const rows = doneTodayRows({
      current: load({ stops: [stop({ status: 'completed', completed_at: at(18, 0, -1) }), delivery()] }),
      previous: [
        load({ id: 'a', status: 'delivered', completed_at: at(4) }),
        load({ id: 'b', status: 'delivered', completed_at: at(4, 0, -1) }),
        load({ id: 'c', status: 'canceled', completed_at: at(4) }),
      ],
      now: NOW,
    });
    expect(rows.map((r) => r.key)).toEqual(['delivered-a']);
  });

  it('the rig row names the units and offers the swap', () => {
    expect(rigRow({ vehicleUnit: '2241', trailerUnit: '53118', elapsed: '2h 10m' })).toMatchObject({
      title: 'Unit 2241 · trailer 53118', subtitle: 'On duty 2h 10m', href: '/duty/check-in?mode=swap',
    });
    expect(rigTitle('2241', null)).toBe('Unit 2241 · bobtail');
    expect(rigTitle(null, null)).toBe('Truck not recorded');
  });

  it('before the shift, the row names the rig the one-tap start will use', () => {
    expect(startRigRow('2241', '53118')).toMatchObject({ title: 'Unit 2241 · trailer 53118', subtitle: 'Same rig as your last shift', href: '/duty/check-in' });
    expect(startRigRow('2241', null)).toMatchObject({ title: 'Unit 2241 · bobtail', subtitle: 'Same truck as your last shift' });
  });
});

describe('heroClock', () => {
  it('moves a 12-hour day period out of the figure, and leaves a 24-hour time whole', () => {
    expect(splitDayPeriod('4:27\u202fPM')).toEqual({ time: '4:27', period: 'PM' });
    expect(splitDayPeriod('04:27 a.m.')).toEqual({ time: '04:27', period: 'a.m.' });
    expect(splitDayPeriod('16:27')).toEqual({ time: '16:27', period: null });
    const { time, period } = heroClock(at(16, 27));
    expect(`${time}${period ? ` ${period}` : ''}`.replace(/\s/g, '')).toBe(clock(at(16, 27)).replace(/\s/g, ''));
  });
});

describe('dayWord', () => {
  it('is null today, "tomorrow" next, and a weekday after that', () => {
    expect(dayWord(at(23), NOW)).toBeNull();
    expect(dayWord(at(1, 0, 1), NOW)).toBe('tomorrow');
    expect(dayWord(at(1, 0, 3), NOW)).toMatch(/^on /);
  });
});
