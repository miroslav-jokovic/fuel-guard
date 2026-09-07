import { describe, expect, it } from 'vitest';
import type { Load, LoadStop } from '@silvicom/shared';
import {
  acceptedUpcoming,
  backers,
  defaultChip,
  headerSentence,
  orderOffers,
} from '@/features/loads/offerDeckModel';

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function load(n: number, status: Load['status'], firstAppt: string | null): Load {
  const stop: LoadStop = {
    id: id(100 + n), seq: 1, kind: 'pickup', name: 'Yard', address_line: null, city: 'Joliet',
    state: 'IL', postal_code: null, lat: null, lon: null, appointment_start: firstAppt,
    appointment_end: null, status: 'pending', arrived_at: null, completed_at: null,
    required_photos: [], skip_reason: null, notes: null, photos: [],
  };
  return {
    id: id(n), ref: `LD-${n}`, status, equipment: 'Dry van', commodity: null, hazmat: false,
    total_miles: 100, accepted_at: null, completed_at: null, notes: null,
    created_at: '2026-09-01T00:00:00Z', vehicle_unit: null, trailer_unit: null, stops: [stop],
  };
}

describe('headerSentence', () => {
  it('leaves out the zero terms rather than printing holes', () => {
    expect(headerSentence({ current: 1, offered: 2, upcoming: 3 })).toBe('1 in progress · 2 offered · 3 upcoming');
    expect(headerSentence({ current: 0, offered: 2, upcoming: 0 })).toBe('2 offered');
    expect(headerSentence({ current: 1, offered: 0, upcoming: 4 })).toBe('1 in progress · 4 upcoming');
  });

  it('says so plainly when there is nothing', () => {
    expect(headerSentence({ current: 0, offered: 0, upcoming: 0 })).toBe('No loads yet');
  });
});

describe('defaultChip', () => {
  it('opens on an offer whenever one exists, ahead even of the load being driven', () => {
    // An offer is the only thing here with a deadline: dispatch is waiting on the driver's answer.
    expect(defaultChip({ current: 1, offered: 1, upcoming: 5 })).toBe('offered');
  });

  it('falls back to the load in progress, then to what is assigned', () => {
    expect(defaultChip({ current: 1, offered: 0, upcoming: 5 })).toBe('current');
    expect(defaultChip({ current: 0, offered: 0, upcoming: 5 })).toBe('upcoming');
    expect(defaultChip({ current: 0, offered: 0, upcoming: 0 })).toBe('upcoming');
  });
});

describe('orderOffers / acceptedUpcoming', () => {
  // `loadBucket` puts offered AND accepted in `upcoming`, so this split is the screen's job.
  const mixed = [
    load(1, 'accepted', '2026-09-08T06:00:00Z'),
    load(2, 'offered', '2026-09-10T06:00:00Z'),
    load(3, 'offered', '2026-09-09T06:00:00Z'),
    load(4, 'accepted', '2026-09-07T06:00:00Z'),
  ];

  it('takes only offers, soonest pickup first', () => {
    expect(orderOffers(mixed).map((l) => l.id)).toEqual([id(3), id(2)]);
  });

  it('takes only assignments, soonest pickup first', () => {
    expect(acceptedUpcoming(mixed).map((l) => l.id)).toEqual([id(4), id(1)]);
  });

  it('never lets a load appear in both lists', () => {
    const inBoth = orderOffers(mixed).filter((o) => acceptedUpcoming(mixed).some((a) => a.id === o.id));
    expect(inBoth).toEqual([]);
  });
});

describe('backers', () => {
  it('draws a plate per extra offer and stops at two', () => {
    expect(backers(0)).toBe(0);
    expect(backers(1)).toBe(0);
    expect(backers(2)).toBe(1);
    expect(backers(3)).toBe(2);
    // A third plate is 2pt of visible edge — depth stops reading and starts looking like a bug.
    expect(backers(9)).toBe(2);
  });
});
