import type { Load, LoadStop } from '@silvicom/shared';

/**
 * Gallery fixtures — the ONLY place in this app sample load values live (§4 rule 8). They exist so
 * the offer deck can be reviewed at both driver types and at two, one and zero offers without a
 * dispatcher pushing real work at a simulator.
 */
function stop(seq: number, city: string, state: string, at: string, kind: LoadStop['kind']): LoadStop {
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    seq, kind, name: `${city} DC`, address_line: null, city, state, postal_code: null,
    lat: null, lon: null, appointment_start: at, appointment_end: null, status: 'pending',
    arrived_at: null, completed_at: null, required_photos: [], skip_reason: null, notes: null,
    photos: [],
  };
}

export const SAMPLE_OFFERS: Load[] = [
  {
    id: '00000000-0000-4000-8000-000000000901', ref: 'LD-20614', status: 'offered',
    equipment: 'Dry van', commodity: 'Palletised dry goods', hazmat: false, total_miles: 412,
    accepted_at: null, completed_at: null, notes: null, created_at: '2026-09-07T09:12:00Z',
    vehicle_unit: null, trailer_unit: null,
    stops: [
      stop(1, 'Joliet', 'IL', '2026-09-08T06:30:00Z', 'pickup'),
      stop(2, 'Effingham', 'IL', '2026-09-08T14:00:00Z', 'dropoff'),
    ],
  },
  {
    id: '00000000-0000-4000-8000-000000000902', ref: 'LD-20618', status: 'offered',
    equipment: 'Tanker', commodity: 'UN1203 Gasoline', hazmat: true, total_miles: 168,
    accepted_at: null, completed_at: null, notes: null, created_at: '2026-09-07T10:40:00Z',
    vehicle_unit: null, trailer_unit: null,
    stops: [
      stop(3, 'Hammond', 'IN', '2026-09-09T05:00:00Z', 'pickup'),
      stop(4, 'Peoria', 'IL', '2026-09-09T11:30:00Z', 'dropoff'),
    ],
  },
];
