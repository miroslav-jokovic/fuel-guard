import type { EquipmentOption, MeEquipmentResponse, OdometerMode } from '@silvicom/shared';
import type { LastEquipment } from '@/lib/lastEquipment';

export interface StartShortcut {
  vehicle: EquipmentOption;
  /** Null means bobtail — the driver pulled a trailer yesterday and it is not free today. */
  trailer: EquipmentOption | null;
}

/**
 * Whether the driver can start their day in one tap.
 *
 * Most days are the same rig as yesterday, and making a driver walk a two-step wizard to say so is
 * the single most repeated piece of friction in the app. But the shortcut is only honest when it can
 * be certain, so it declines in every doubtful case rather than guessing:
 *
 * - the remembered vehicle must still exist on the roster AND be free. `in_use_by` is the server's
 *   word, and only the server can know someone else took that truck at 04:00 (D44.7).
 * - the remembered trailer is optional. If it is gone or taken, the shortcut still stands and offers
 *   BOBTAIL, because "same truck, no trailer yet" is a real and common morning — but it never
 *   silently substitutes a different trailer.
 * - an org that REQUIRES an odometer reading gets no shortcut at all: there is nothing to prefill,
 *   and a one-tap button that opens a form is not a one-tap button.
 */
export function startShortcut(
  last: LastEquipment,
  roster: MeEquipmentResponse | undefined,
  odometerMode: OdometerMode,
): StartShortcut | null {
  if (odometerMode === 'required') return null;
  if (!last.vehicleId || !roster) return null;

  const vehicle = roster.vehicles.find((v) => v.id === last.vehicleId);
  if (!vehicle) return null;
  // Only the server knows a colleague claimed this truck at 04:00 (D44.7).
  if (vehicle.in_use_by !== null) return null;

  const trailer = last.trailerId
    ? (roster.trailers.find((t) => t.id === last.trailerId) ?? null)
    : null;

  return { vehicle, trailer: trailer?.in_use_by === null ? trailer : null };
}

/** "Unit 4471 · Freightliner Cascadia", or just the unit when the roster has no make or model. */
export function equipmentLine(option: EquipmentOption): string {
  const makeModel = [option.make, option.model].filter(Boolean).join(' ');
  return makeModel ? `Unit ${option.unit_number} · ${makeModel}` : `Unit ${option.unit_number}`;
}
