import type { Load } from '@silvicom/shared';

/** Offers, soonest pickup first: the one that expires first is the one to answer first. */
export function orderOffers(upcoming: readonly Load[]): Load[] {
  return upcoming
    .filter((load) => load.status === 'offered')
    .sort((a, b) => (firstAppointment(a) ?? '').localeCompare(firstAppointment(b) ?? ''));
}

/** Loads the driver has accepted but not started. `upcoming` holds both; only these are assignments. */
export function acceptedUpcoming(upcoming: readonly Load[]): Load[] {
  return upcoming
    .filter((load) => load.status !== 'offered')
    .sort((a, b) => (firstAppointment(a) ?? '').localeCompare(firstAppointment(b) ?? ''));
}

/**
 * The plates drawn behind the front offer, so a deck of three reads as three without the driver
 * counting. Two is the ceiling: a third plate is 2pt of visible edge and reads as a rendering
 * artefact rather than depth.
 */
export function backers(offerCount: number): number {
  if (offerCount >= 3) return 2;
  if (offerCount === 2) return 1;
  return 0;
}

function firstAppointment(load: Load): string | null {
  const ordered = [...load.stops].sort((a, b) => a.seq - b.seq);
  return ordered[0]?.appointment_start ?? null;
}
