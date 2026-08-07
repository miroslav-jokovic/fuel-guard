import type { EquipmentOption } from '@fuelguard/shared';
import type { TaskStep } from '@/components';

/**
 * Check-in wizard model (hardening plan Phase 1). Pure — no React, no React Native — so every
 * transition is unit-testable and the screen stays a thin renderer.
 *
 * Why a real wizard: the previous screen rendered a TaskStepper that implied "Truck → Trailer →
 * Confirm" but put both rosters on one scroll page behind ONE shared search box. Searching "214"
 * to find a truck left the trailer list filtered by "214" — zero rows, no empty state — so
 * selecting a vehicle appeared to go nowhere (the exact defect reported on-device). The model makes
 * progression explicit: one decision per step, search scoped per step, selection advances.
 */

export type CheckInMode = 'start' | 'swap';
export type CheckInStep = 'truck' | 'trailer' | 'confirm';

/** Dashboard-configured via the `duty.odometer` feature (D-PM2) — the screen reads it from
 *  `useFeatures()`; the shared featureCatalog owns the default. Structural mirror of shared's
 *  OdometerMode, kept local so this model stays dependency-light and pure. */
export type OdometerMode = 'off' | 'optional' | 'required';

export interface CheckInState {
  step: CheckInStep;
  /** Chosen truck; null in swap mode means "keep the current one". */
  vehicle: EquipmentOption | null;
  trailer: EquipmentOption | null;
  bobtail: boolean;
  /** Swap-mode explicit "keep" choices — they advance the step without changing equipment. */
  keptVehicle: boolean;
  keptTrailer: boolean;
}

export function initialState(): CheckInState {
  return { step: 'truck', vehicle: null, trailer: null, bobtail: false, keptVehicle: false, keptTrailer: false };
}

/** Picking a truck (or confirming its take-over) completes step 1 and advances. */
export function selectVehicle(state: CheckInState, option: EquipmentOption): CheckInState {
  return { ...state, vehicle: option, keptVehicle: false, step: 'trailer' };
}

/** Swap mode: keep the current truck — a decision, not a skip, so it advances the same way. */
export function keepVehicle(state: CheckInState): CheckInState {
  return { ...state, vehicle: null, keptVehicle: true, step: 'trailer' };
}

export function selectTrailer(state: CheckInState, option: EquipmentOption): CheckInState {
  return { ...state, trailer: option, bobtail: false, keptTrailer: false, step: 'confirm' };
}

/** "Not hooked yet" is a first-class answer (D44.2), and it completes the trailer step. */
export function chooseBobtail(state: CheckInState): CheckInState {
  return { ...state, trailer: null, bobtail: true, keptTrailer: false, step: 'confirm' };
}

/** Swap mode: keep the current trailer (or current bobtail state). */
export function keepTrailer(state: CheckInState): CheckInState {
  return { ...state, trailer: null, bobtail: false, keptTrailer: true, step: 'confirm' };
}

/** Back preserves selections — a driver stepping back to re-pick loses nothing. */
export function goBack(state: CheckInState): CheckInState {
  if (state.step === 'confirm') return { ...state, step: 'trailer' };
  if (state.step === 'trailer') return { ...state, step: 'truck' };
  return state;
}

/** Swap mode only saves when something actually changes; keeping both is a no-op, not a request. */
export function hasChanges(state: CheckInState, mode: CheckInMode): boolean {
  if (mode === 'start') return true;
  return state.vehicle !== null || state.trailer !== null || state.bobtail;
}

export function canSubmit(
  state: CheckInState,
  mode: CheckInMode,
  odometerMode: OdometerMode,
  odometerText: string,
): boolean {
  if (state.step !== 'confirm') return false;
  if (mode === 'start') {
    if (!state.vehicle) return false;
    if (odometerMode === 'required' && !isValidOdometer(odometerText)) return false;
    return true;
  }
  return hasChanges(state, mode);
}

export function isValidOdometer(text: string): boolean {
  const n = Number.parseFloat(text);
  return Number.isFinite(n) && n > 0;
}

/** Parsed odometer for the request payload, or undefined when absent/invalid (and not required). */
export function odometerValue(text: string): number | undefined {
  const n = Number.parseFloat(text);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** The stepper now reflects REAL progression — each step is complete exactly when it was decided. */
export function stepperSteps(state: CheckInState, mode: CheckInMode): TaskStep[] {
  const truckDone = state.vehicle !== null || state.keptVehicle;
  const trailerDone = state.trailer !== null || state.bobtail || state.keptTrailer;
  const truck: TaskStep = {
    label: 'Truck',
    state: truckDone ? 'complete' : state.step === 'truck' ? 'current' : 'upcoming',
  };
  const trailer: TaskStep = {
    label: 'Trailer',
    state: trailerDone ? 'complete' : state.step === 'trailer' ? 'current' : 'upcoming',
  };
  const confirm: TaskStep = {
    label: mode === 'swap' ? 'Save' : 'Confirm',
    state: state.step === 'confirm' ? 'current' : 'upcoming',
  };
  return [truck, trailer, confirm];
}

/**
 * Roster ranking: the unit this driver used LAST first (recent-first, D-PM9 — the Samsara
 * selection-aid we can do offline from local history), then "your truck", then free units, then
 * held units last — a driver should have to work to take someone else's unit, not stumble into it.
 * Ties break on natural unit-number order.
 */
export function rankEquipment(
  options: readonly EquipmentOption[],
  lastUsedId: string | null,
): EquipmentOption[] {
  return [...options].sort((a, b) => {
    const aLast = a.id === lastUsedId;
    const bLast = b.id === lastUsedId;
    if (aLast !== bLast) return aLast ? -1 : 1;
    if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
    const aHeld = a.in_use_by !== null;
    const bHeld = b.in_use_by !== null;
    if (aHeld !== bHeld) return aHeld ? 1 : -1;
    return a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true });
  });
}

/** Case-insensitive roster filter by unit number / make / model (per-step — never shared). */
export function filterEquipment(
  options: readonly EquipmentOption[],
  query: string,
): EquipmentOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...options];
  return options.filter(
    (o) =>
      o.unit_number.toLowerCase().includes(q) ||
      (o.make ?? '').toLowerCase().includes(q) ||
      (o.model ?? '').toLowerCase().includes(q),
  );
}
