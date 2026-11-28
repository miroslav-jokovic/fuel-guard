import type { Load, LoadStop } from '@silvicom/shared';
import { Section } from '@/components';
import { DayRows } from '@/screens/today/DayRows';
import { TodayStatus } from '@/screens/today/TodayStatus';
import {
  activeLoadStatus,
  activeNextStep,
  betweenLoadsNextStep,
  betweenLoadsStatus,
  doneTodayRows,
  preShiftStatus,
  remainingStopRows,
  rigRow,
} from '@/screens/today/todayStatusModel';

/**
 * Today's states (Visual 2026 V5) drawn by the REAL model from fixture loads, because the dev bypass
 * has no API and so can only ever show Today's recovery state. Times are relative to now, so the
 * countdowns read the way they would on the road. Every figure here is a fixture.
 */
const H = 3_600_000;
const iso = (offsetHours: number) => new Date(Date.now() + offsetHours * H).toISOString();

function stop(over: Partial<LoadStop>): LoadStop {
  return {
    id: `00000000-0000-4000-8000-${String(over.seq ?? 1).padStart(12, '0')}`,
    seq: 1, kind: 'pickup', name: 'Ardent Mills', address_line: null, city: 'Chicago', state: 'IL',
    postal_code: null, lat: null, lon: null, appointment_start: iso(0.3), appointment_end: iso(2.3),
    status: 'pending', arrived_at: null, completed_at: null, required_photos: ['bol', 'seal'],
    skip_reason: null, notes: null, photos: [], external_status: null, actual_arrival_at: null, actual_departure_at: null, mcleod_removed_at: null, ...over,
  };
}

const kroger = stop({ seq: 2, kind: 'dropoff', name: 'Kroger DC', city: 'Indianapolis', state: 'IN', appointment_start: iso(8), appointment_end: iso(10), required_photos: ['bol'] });

function load(stops: LoadStop[], over: Partial<Load> = {}): Load {
  return {
    id: '11111111-1111-4111-8111-111111111111', ref: '1184530', status: 'in_transit', equipment: 'Dry van',
    commodity: null, hazmat: false, total_miles: 183, accepted_at: null, completed_at: null, notes: null,
    created_at: iso(-12), vehicle_unit: '2241', trailer_unit: '53118', source: 'manual', acknowledged_at: null, customer_name: null, stops, ...over,
  };
}

const beforeArrival = load([stop({}), kroger]);
const arrivedMissing = load([stop({ status: 'arrived', appointment_start: iso(-0.5), photos: [{ id: 'p1', slot: 'bol', storage_path: 'x', captured_at: null, uploaded_at: iso(-0.2) }] }), kroger]);
const late = load([stop({ appointment_start: iso(-3), appointment_end: iso(-1) }), kroger]);
const betweenStops = load([stop({ status: 'completed', completed_at: iso(-0.1), photos: [{ id: 'p1', slot: 'bol', storage_path: 'x', captured_at: null, uploaded_at: iso(-0.2) }] }), stop({ ...kroger, appointment_start: iso(0.7), appointment_end: iso(2.7) })]);
const rig = rigRow({ vehicleUnit: '2241', trailerUnit: '53118', elapsed: '2h 10m' });

export function TodaySamples() {
  return (
    <>
      <Section title="Today · before the shift">
        <TodayStatus status={preShiftStatus({ unit: '2241', firstLoad: load([stop({})], { status: 'accepted' }) })} next={null} />
      </Section>
      <Section title="Today · before arrival">
        <TodayStatus status={activeLoadStatus(beforeArrival)} next={activeNextStep(beforeArrival)} />
        <DayRows rows={[...remainingStopRows(beforeArrival), rig]} />
      </Section>
      <Section title="Today · at the stop, a photo missing">
        <TodayStatus status={activeLoadStatus(arrivedMissing)} next={activeNextStep(arrivedMissing)} />
      </Section>
      <Section title="Today · late">
        <TodayStatus status={activeLoadStatus(late)} next={activeNextStep(late)} />
      </Section>
      <Section title="Today · between stops, seal photo missing">
        <TodayStatus status={activeLoadStatus(betweenStops)} next={activeNextStep(betweenStops)} />
        <DayRows rows={doneTodayRows({ current: betweenStops, previous: [] })} />
      </Section>
      <Section title="Today · between loads">
        <TodayStatus
          status={betweenLoadsStatus({ elapsed: '2h 10m', unit: '2241', nextLoad: load([stop({ appointment_start: iso(4), appointment_end: iso(6) }), kroger], { status: 'offered' }) })}
          next={betweenLoadsNextStep(load([stop({}), kroger], { status: 'offered' }))}
        />
      </Section>
    </>
  );
}
