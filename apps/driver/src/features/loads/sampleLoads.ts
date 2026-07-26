import type { LoadSummary } from './LoadCard';
import type { ActiveLoad } from './CurrentLoadCard';

// ── PLACEHOLDER DATA ─────────────────────────────────────────────────────────
// Design-time sample loads so the Loads/Home surfaces are real UI, not lorem boxes.
// Replaced by the Phase-2 data layer (['me','loads'] cache) + Phase-3 endpoints; the
// shapes intentionally mirror the LoadSummary/ActiveLoad view-models those phases fill.

export const SAMPLE_ACTIVE: ActiveLoad = {
  id: 'ld_002',
  ref: 'LD-20481',
  status: 'in_transit',
  origin: 'Joliet, IL',
  originTime: 'Today 06:30',
  destination: 'Columbus, OH',
  destTime: 'Today 16:00',
  stops: 3,
  miles: '361 mi',
  equipment: 'Dry van',
  progress: { current: 2, total: 3 },
  nextStop: 'Indianapolis, IN',
  nextAction: 'Deliver',
  appointment: 'Appt 12:00 – 14:00',
};

export const SAMPLE_UPCOMING: LoadSummary[] = [
  {
    id: 'ld_003',
    ref: 'LD-20492',
    status: 'upcoming',
    origin: 'Columbus, OH',
    originTime: 'Tomorrow 08:00',
    destination: 'Pittsburgh, PA',
    destTime: 'Tomorrow 13:30',
    stops: 2,
    miles: '185 mi',
    equipment: 'Dry van',
  },
  {
    id: 'ld_004',
    ref: 'LD-20495',
    status: 'upcoming',
    origin: 'Pittsburgh, PA',
    originTime: 'Wed 07:00',
    destination: 'Newark, NJ',
    destTime: 'Wed 15:45',
    stops: 2,
    miles: '372 mi',
    equipment: 'Reefer',
    hazmat: true,
  },
];

export const SAMPLE_PREVIOUS: LoadSummary[] = [
  {
    id: 'ld_001',
    ref: 'LD-20473',
    status: 'delivered',
    origin: 'Chicago, IL',
    originTime: 'Fri 05:45',
    destination: 'Joliet, IL',
    destTime: 'Fri 09:10',
    stops: 2,
    miles: '48 mi',
    equipment: 'Dry van',
  },
  {
    id: 'ld_000',
    ref: 'LD-20466',
    status: 'delivered',
    origin: 'Milwaukee, WI',
    originTime: 'Thu 06:15',
    destination: 'Chicago, IL',
    destTime: 'Thu 11:40',
    stops: 3,
    miles: '92 mi',
    equipment: 'Flatbed',
  },
];
