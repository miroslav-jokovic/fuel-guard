import { describe, expect, it } from 'vitest';
import type { Load, LoadStop, MeHazmatLoadRow } from '@silvicom/shared';
import { documentsView, hazmatRows } from '@/features/documents/documentsModel';

const NOW = new Date(2026, 10, 20, 13, 20).getTime();
const at = (h: number, dayOffset = 0) => new Date(2026, 10, 20 + dayOffset, h, 0).toISOString();
const photo = (slot: string, uploaded = at(7)) => ({ id: `p-${slot}-${uploaded}`, slot, storage_path: 'x', captured_at: null, uploaded_at: uploaded });

function stop(seq: number, over: Partial<LoadStop> = {}): LoadStop {
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, seq, kind: seq === 1 ? 'pickup' : 'dropoff',
    name: seq === 1 ? 'Ardent Mills' : 'Kroger DC', address_line: null, city: null, state: null, postal_code: null,
    lat: null, lon: null, appointment_start: null, appointment_end: null, status: 'pending', arrived_at: null,
    completed_at: null, required_photos: [], skip_reason: null, notes: null, photos: [], external_status: null, actual_arrival_at: null, actual_departure_at: null, mcleod_removed_at: null, ...over,
  };
}

function load(over: Partial<Load> = {}): Load {
  return {
    id: '11111111-1111-4111-8111-111111111111', ref: '1184530', status: 'in_transit', equipment: null, commodity: null,
    hazmat: false, total_miles: null, accepted_at: null, completed_at: null, notes: null, created_at: at(0, -1),
    vehicle_unit: null, trailer_unit: null, source: 'manual', acknowledged_at: null, customer_name: null, stops: [stop(1), stop(2)], ...over,
  };
}

describe('documentsView (mock screen 7)', () => {
  it('lists what is missing: the open stop first as "take", a later stop as "later"', () => {
    const view = documentsView([load({
      stops: [stop(1, { required_photos: ['seal', 'bol'], photos: [photo('bol')] }), stop(2, { required_photos: ['bol'] })],
    })], NOW);
    expect(view.missing.map((m) => [m.title, m.when])).toEqual([
      ['Seal · Ardent Mills', 'take'],
      ['Bill of lading · Kroger DC', 'later'],
    ]);
    expect(view.actionable).toBe(2);
    expect(view.missingNote).toBe('Both are on load 1184530. The office sees them as soon as you send them.');
  });

  it('a completed stop without its photo takes it late inside the window, counted as something to do (D-DV30)', () => {
    const view = documentsView([load({
      stops: [stop(1, { status: 'completed', completed_at: at(9), required_photos: ['seal'] }), stop(2, { required_photos: ['bol'] })],
    })], NOW);
    expect(view.missing.map((m) => m.when)).toEqual(['take', 'late']);
    expect(view.missing[1]?.subtitle).toMatch(/finished without it$/);
    expect(view.actionable).toBe(2);
  });

  it('past the late-photo window the gap is a record at the end, not counted', () => {
    const view = documentsView([load({
      stops: [stop(1, { status: 'completed', completed_at: at(9, -15), required_photos: ['seal'] }), stop(2, { required_photos: ['bol'] })],
    })], NOW);
    expect(view.missing.map((m) => m.when)).toEqual(['take', 'record']);
    expect(view.actionable).toBe(1);
    expect(view.missingNote).toMatch(/^It is on load 1184530\./);
  });

  it('a delivered load owes only the late photos of its completed stops, inside the window', () => {
    const view = documentsView([
      load({ status: 'delivered', stops: [stop(1, { status: 'completed', completed_at: at(9), required_photos: ['bol'] })] }),
      load({ id: '5', status: 'delivered', stops: [stop(1, { status: 'completed', completed_at: at(9, -20), required_photos: ['bol'] })] }),
    ], NOW);
    expect(view.missing.map((m) => [m.loadId, m.when])).toEqual([['11111111-1111-4111-8111-111111111111', 'late']]);
  });

  it('owes nothing for a skipped stop, or on a load not being driven yet (offered, accepted, delivered)', () => {
    const view = documentsView([
      load({ stops: [stop(1, { status: 'skipped', required_photos: ['seal'] })] }),
      load({ id: '2', status: 'offered', stops: [stop(1, { required_photos: ['bol'] })] }),
      load({ id: '4', status: 'accepted', stops: [stop(1, { required_photos: ['bol'] })] }),
      load({ id: '3', status: 'delivered', stops: [stop(1, { required_photos: ['bol'] })] }),
    ], NOW);
    expect(view.missing).toEqual([]);
    expect(view.actionable).toBe(0);
    expect(view.missingNote).toBeNull();
  });

  it('counts only photos the server received in the last seven days as sent', () => {
    const view = documentsView([
      load({ stops: [stop(1, { photos: [photo('bol', at(9)), photo('seal', at(9, -2))] })] }),
      load({ id: '2', status: 'delivered', stops: [stop(1, { photos: [photo('bol', at(9, -3)), photo('trailer', at(9, -30))] })] }),
    ], NOW);
    expect(view.sentThisWeek).toEqual({ photos: 3, loads: 2 });
    expect(documentsView([load()], NOW).sentThisWeek).toBeNull();
  });
});

describe('hazmatRows', () => {
  const row = (over: Partial<MeHazmatLoadRow>): MeHazmatLoadRow => ({
    id: 'h1', status: 'submitted', created_at: at(9, -1), latest_outcome: null, ...over,
  });

  it('says each verdict as a word in its state colour', () => {
    expect(hazmatRows([
      row({ latest_outcome: 'cleared' }),
      row({ latest_outcome: 'rejected' }),
      row({ latest_outcome: 'needs_review' }),
      row({ latest_outcome: 'something_new' }),
      row({ status: 'draft' }),
      row({}),
    ]).map((r) => r.verdict)).toEqual([
      { text: 'Cleared', tone: 'done' },
      { text: 'Rejected', tone: 'stop' },
      { text: 'In review', tone: 'act' },
      { text: 'In review', tone: 'act' },
      { text: 'Not sent', tone: 'neutral' },
      { text: 'Analyzing', tone: 'live' },
    ]);
  });

  it('names a draft as saved on the phone, and dates the check MM/DD', () => {
    const [r] = hazmatRows([row({ status: 'draft' })]);
    expect(r?.subtitle).toBe('Saved on this phone · sends when you have signal');
    expect(r?.title).toBe('BOL check · 11/19');
  });
});
