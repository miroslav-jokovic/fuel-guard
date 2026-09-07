import type { Load } from '@silvicom/shared';

export type LoadChip = 'offered' | 'current' | 'upcoming' | 'history';

export interface LoadCounts {
  offered: number;
  current: number;
  upcoming: number;
}

/**
 * How many loads are in play, in one sentence, with the zero terms left out.
 *
 * "0 in progress · 2 offered · 0 upcoming" is three facts to read to learn one. A driver scanning
 * a header wants the shape of their week, not a table with holes in it.
 */
export function headerSentence(counts: LoadCounts): string {
  const parts = [
    counts.current > 0 ? `${counts.current} in progress` : null,
    counts.offered > 0 ? `${counts.offered} offered` : null,
    counts.upcoming > 0 ? `${counts.upcoming} upcoming` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'No loads yet';
}

/**
 * Which tab the screen opens on. An offer is the only thing here with a deadline attached — it can
 * be withdrawn, and until the driver answers it, dispatch is waiting on them. So it leads whenever
 * one exists, ahead even of the load being driven.
 */
export function defaultChip(counts: LoadCounts): LoadChip {
  if (counts.offered > 0) return 'offered';
  if (counts.current > 0) return 'current';
  return 'upcoming';
}

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
