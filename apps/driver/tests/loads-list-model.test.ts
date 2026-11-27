import { describe, expect, it } from 'vitest';
import type { Load, LoadStop } from '@silvicom/shared';
import { clock, loadsListView, noteFor, routeLine } from '@/features/loads/loadsListModel';

const NOW = new Date(2026, 10, 20, 5, 42).getTime();
const at = (h: number, dayOffset = 0) => new Date(2026, 10, 20 + dayOffset, h, 0).toISOString();

function stop(seq: number, over: Partial<LoadStop> = {}): LoadStop {
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, seq, kind: seq === 1 ? 'pickup' : 'dropoff',
    name: seq === 1 ? 'Ardent Mills' : 'Kroger DC', address_line: null,
    city: seq === 1 ? 'Chicago' : 'Indianapolis', state: seq === 1 ? 'IL' : 'IN', postal_code: null, lat: null, lon: null,
    appointment_start: at(seq === 1 ? 6 : 14), appointment_end: null, status: 'pending', arrived_at: null,
    completed_at: null, required_photos: [], skip_reason: null, notes: null, photos: [], external_status: null, actual_arrival_at: null, actual_departure_at: null, mcleod_removed_at: null, ...over,
  };
}

let n = 0;
function load(status: Load['status'], over: Partial<Load> = {}): Load {
  n += 1;
  return {
    id: `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`, ref: String(1184500 + n), status,
    equipment: 'Dry van', commodity: null, hazmat: false, total_miles: 183, accepted_at: null, completed_at: null,
    notes: null, created_at: at(0, -10), vehicle_unit: null, trailer_unit: null, source: 'manual', acknowledged_at: null, customer_name: null, stops: [stop(1), stop(2)], ...over,
  };
}

describe('loadsListView (mock screen 4)', () => {
  it('groups by time, Now / Next / Delivered this week / Earlier, and drops empty groups', () => {
    const view = loadsListView([
      load('in_transit'),
      load('accepted'),
      load('delivered', { completed_at: at(12, -2) }),
      load('delivered', { completed_at: at(12, -20) }),
    ], NOW);
    expect(view.groups.map((g) => g.title)).toEqual(['Now', 'Next', 'Delivered this week', 'Earlier']);
    expect(loadsListView([load('accepted')], NOW).groups.map((g) => g.key)).toEqual(['next']);
  });

  it('keeps offers out of the groups, for the offer deck', () => {
    const offer = load('offered');
    const view = loadsListView([offer, load('accepted')], NOW);
    expect(view.offers.map((o) => o.id)).toEqual([offer.id]);
    expect(view.groups.flatMap((g) => g.rows).map((r) => r.loadId)).not.toContain(offer.id);
  });

  it('the live load is cyan with its NEXT open stop\'s window, not the first stop\'s', () => {
    const live = load('in_transit', { stops: [stop(1, { status: 'completed' }), stop(2)] });
    const [row] = loadsListView([live], NOW).groups[0]?.rows ?? [];
    expect(row).toMatchObject({ state: 'live', title: `Load ${live.ref}`, figure: clock(at(14)), figureNote: 'next window' });
    expect(row?.subtitle).toBe('Chicago, IL → Indianapolis, IN · 183 mi');
  });

  it('a load ahead shows its first appointment as the time, and the day in the note when it is not today', () => {
    const ahead = load('accepted', { stops: [stop(1, { appointment_start: at(8, 1) }), stop(2)] });
    const row = loadsListView([ahead], NOW).groups[0]?.rows[0];
    expect(row?.figure).toBe(clock(at(8, 1)));
    expect(row?.figureNote).toBe(noteFor(at(8, 1), NOW, 'pickup'));
    expect(row?.figureNote).toMatch(/^\S+ · pickup$/);
    expect(noteFor(at(9), NOW, 'pickup')).toBe('pickup');
  });

  it('finished loads: newest first, a canceled one says so and is not "done"', () => {
    const older = load('delivered', { completed_at: at(9, -3) });
    const newer = load('canceled', { completed_at: at(9, -1) });
    const rows = loadsListView([older, newer], NOW).groups[0]?.rows ?? [];
    expect(rows.map((r) => r.loadId)).toEqual([newer.id, older.id]);
    expect(rows[0]).toMatchObject({ state: 'off', subtitle: 'Chicago, IL → Indianapolis, IN · Canceled' });
    expect(rows[1]?.state).toBe('done');
  });

  it('never invents miles: a load with none leaves them out', () => {
    expect(routeLine(load('accepted', { total_miles: null }))).toBe('Chicago, IL → Indianapolis, IN');
  });
});
