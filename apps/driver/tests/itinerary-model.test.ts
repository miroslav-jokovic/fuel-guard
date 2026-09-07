import { describe, expect, it } from 'vitest';
import type { Load, LoadStop } from '@silvicom/shared';
import {
  connectorDone,
  itineraryRows,
  nodeState,
  photoCount,
  photoTileState,
  windowVerdict,
} from '@/features/loads/itineraryModel';

const NOW = Date.parse('2026-09-07T15:00:00Z');

/**
 * The window text is rendered in the DEVICE locale and timezone, which is the correct behaviour and
 * makes an exact-string assertion a test of the CI runner rather than of the rule. So the verdict
 * and the arithmetic — the parts this module actually decides — are asserted exactly, and the clock
 * prefix only has to be present.
 */
function detailTail(detail: string | undefined): string {
  return detail?.slice(detail.indexOf(' · ') + 3) ?? '';
}

function stop(over: Partial<LoadStop> = {}): LoadStop {
  return {
    id: `00000000-0000-4000-8000-${String(over.seq ?? 1).padStart(12, '0')}`,
    seq: 1, kind: 'dropoff', name: 'Effingham DC', address_line: null, city: 'Effingham',
    state: 'IL', postal_code: null, lat: null, lon: null,
    appointment_start: '2026-09-07T14:00:00Z', appointment_end: '2026-09-07T16:00:00Z',
    status: 'pending', arrived_at: null, completed_at: null, required_photos: [],
    skip_reason: null, notes: null, photos: [], ...over,
  };
}

function load(stops: LoadStop[]): Load {
  return {
    id: '11111111-1111-4111-8111-111111111111', ref: 'LD-1', status: 'in_transit',
    equipment: 'Dry van', commodity: null, hazmat: false, total_miles: 100, accepted_at: null,
    completed_at: null, notes: null, created_at: '2026-09-01T00:00:00Z', vehicle_unit: null,
    trailer_unit: null, stops,
  };
}

describe('nodeState', () => {
  const next = stop({ seq: 2 });
  it('names each node by what happened to it', () => {
    expect(nodeState(stop({ status: 'completed' }), next)).toBe('complete');
    expect(nodeState(stop({ status: 'skipped' }), next)).toBe('skipped');
    expect(nodeState(next, next)).toBe('next');
    expect(nodeState(stop({ seq: 3 }), next)).toBe('pending');
  });

  it('keeps a skipped stop skipped even when it is the one nextStop would pick', () => {
    // `nextStop` filters skipped out, so this cannot normally happen — but the node must not go
    // green or blue if it ever does, because the run did not pass through it.
    const skipped = stop({ status: 'skipped' });
    expect(nodeState(skipped, skipped)).toBe('skipped');
  });
});

describe('connectorDone', () => {
  it('greens the line only out of a stop that was genuinely worked', () => {
    expect(connectorDone(stop({ status: 'completed' }))).toBe(true);
    expect(connectorDone(stop({ status: 'pending' }))).toBe(false);
    expect(connectorDone(undefined)).toBe(false);
  });

  it('leaves the line grey out of a SKIPPED stop', () => {
    // A green connector out of a skipped stop reads as "done here" on the one stop nobody worked.
    expect(connectorDone(stop({ status: 'skipped' }))).toBe(false);
  });
});

describe('itineraryRows', () => {
  it('orders by seq and points "next" past the skipped stop', () => {
    const rows = itineraryRows(load([
      stop({ seq: 3 }),
      stop({ seq: 1, status: 'completed' }),
      stop({ seq: 2, status: 'skipped' }),
    ]));
    expect(rows.map((r) => r.stop.seq)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.state)).toEqual(['complete', 'skipped', 'next']);
    // The connector into stop 3 comes out of the SKIPPED stop 2, so it stays grey.
    expect(rows.map((r) => r.connectorDone)).toEqual([false, true, false]);
  });
});

describe('windowVerdict', () => {
  it('counts down before the window opens', () => {
    const v = windowVerdict(stop({ arrived_at: null }), Date.parse('2026-09-07T13:15:00Z'));
    expect(v?.title).toBe('Window opens in 45 min');
    expect(detailTail(v?.detail)).toBe('Now 45 min early');
    expect(v?.detail).toMatch(/^Appt .+–.+ · /);
    expect(v?.tone).toBe('neutral');
  });

  it('is plainly good news inside the window', () => {
    expect(windowVerdict(stop(), NOW)?.title).toBe('Inside the window');
    expect(windowVerdict(stop(), NOW)?.tone).toBe('success');
  });

  it('warns once the window has closed', () => {
    const v = windowVerdict(stop(), Date.parse('2026-09-07T16:40:00Z'));
    expect(v?.title).toBe('Past the window');
    expect(detailTail(v?.detail)).toBe('Now 40 min late');
    expect(v?.tone).toBe('warning');
  });

  it('judges an ARRIVED stop by when the driver arrived, not by now', () => {
    // A stop marked arrived at 13:50 for a 14:00 window must still read "early" at 16:30 — otherwise
    // re-opening the screen after the fact turns a good arrival into a late one.
    const arrived = stop({ arrived_at: '2026-09-07T13:50:00Z' });
    const v = windowVerdict(arrived, Date.parse('2026-09-07T16:30:00Z'));
    expect(v?.title).toBe('Early for the window');
    expect(detailTail(v?.detail)).toBe('Arrived 10 min early');
    expect(v?.tone).toBe('neutral');
  });

  it('spells long gaps in hours', () => {
    expect(detailTail(windowVerdict(stop(), Date.parse('2026-09-07T11:05:00Z'))?.detail)).toBe('Now 2 h 55 min early');
    expect(detailTail(windowVerdict(stop(), Date.parse('2026-09-07T12:00:00Z'))?.detail)).toBe('Now 2 h early');
  });

  it('is null with no window at all rather than inventing a verdict', () => {
    expect(windowVerdict(stop({ appointment_start: null, appointment_end: null }), NOW)).toBeNull();
  });
});

describe('photoTileState / photoCount', () => {
  const withPhoto = stop({
    required_photos: ['bol', 'seal', 'trailer'],
    photos: [{ id: 'p1', slot: 'bol', storage_path: 'x', captured_at: null, uploaded_at: '2026-09-07T10:00:00Z' }],
  });

  it('tells a photo taken now apart from one the server already holds', () => {
    // The distinction matters to the tile: only one of the two has an image on this phone.
    expect(photoTileState('seal', withPhoto, [{ slot: 'seal' }])).toBe('captured');
    expect(photoTileState('bol', withPhoto, [])).toBe('already');
    expect(photoTileState('trailer', withPhoto, [])).toBe('required');
  });

  it('counts a capture from this session as satisfied', () => {
    expect(photoCount(withPhoto)).toEqual({ have: 1, total: 3 });
    expect(photoCount(withPhoto, [{ slot: 'seal' }])).toEqual({ have: 2, total: 3 });
    expect(photoCount(stop())).toEqual({ have: 0, total: 0 });
  });
});
