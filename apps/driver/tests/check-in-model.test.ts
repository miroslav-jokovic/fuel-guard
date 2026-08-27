import { describe, expect, it } from 'vitest';
import type { EquipmentOption } from '@silvicom/shared';
import {
  canSubmit,
  chooseBobtail,
  filterEquipment,
  goBack,
  hasChanges,
  initialState,
  keepTrailer,
  keepVehicle,
  rankEquipment,
  selectTrailer,
  selectVehicle,
  stepperSteps,
} from '@/features/duty/checkInModel';

const unit = (over: Partial<EquipmentOption>): EquipmentOption => ({
  id: 'v1',
  unit_number: '100',
  make: null,
  model: null,
  is_default: false,
  in_use_by: null,
  in_use_since: null,
  ...over,
});

describe('check-in wizard transitions (the reported defect class)', () => {
  it('selecting a vehicle ADVANCES to the trailer step — the bug this rebuild fixes', () => {
    const s = selectVehicle(initialState(), unit({ id: 'v1', unit_number: '214' }));
    expect(s.step).toBe('trailer');
    expect(s.vehicle?.unit_number).toBe('214');
  });

  it('trailer, bobtail and keep-trailer each complete the trailer step', () => {
    const afterTruck = selectVehicle(initialState(), unit({}));
    expect(selectTrailer(afterTruck, unit({ id: 't1' })).step).toBe('confirm');
    expect(chooseBobtail(afterTruck).step).toBe('confirm');
    expect(keepTrailer(afterTruck).step).toBe('confirm');
  });

  it('bobtail clears any earlier trailer pick, and a trailer pick clears bobtail', () => {
    const afterTruck = selectVehicle(initialState(), unit({}));
    const bob = chooseBobtail(selectTrailer(afterTruck, unit({ id: 't1' })));
    expect(bob.trailer).toBeNull();
    expect(bob.bobtail).toBe(true);
    const re = selectTrailer({ ...bob, step: 'trailer' }, unit({ id: 't2' }));
    expect(re.bobtail).toBe(false);
    expect(re.trailer?.id).toBe('t2');
  });

  it('back preserves selections so a re-pick loses nothing', () => {
    const s = selectTrailer(selectVehicle(initialState(), unit({ id: 'v1' })), unit({ id: 't1' }));
    const back = goBack(goBack(s));
    expect(back.step).toBe('truck');
    expect(back.vehicle?.id).toBe('v1');
    expect(back.trailer?.id).toBe('t1');
  });
});

describe('submit gating', () => {
  const confirmed = selectTrailer(selectVehicle(initialState(), unit({ id: 'v1' })), unit({ id: 't1' }));

  it('start mode requires a vehicle and the confirm step', () => {
    expect(canSubmit(confirmed, 'start', 'optional', '')).toBe(true);
    expect(canSubmit({ ...confirmed, step: 'trailer' }, 'start', 'optional', '')).toBe(false);
    expect(canSubmit({ ...confirmed, vehicle: null }, 'start', 'optional', '')).toBe(false);
  });

  it('required odometer blocks submit until a valid reading is typed', () => {
    expect(canSubmit(confirmed, 'start', 'required', '')).toBe(false);
    expect(canSubmit(confirmed, 'start', 'required', 'abc')).toBe(false);
    expect(canSubmit(confirmed, 'start', 'required', '412003')).toBe(true);
  });

  it('swap mode with keep + keep is a no-op and cannot be submitted', () => {
    const kept = keepTrailer(keepVehicle(initialState()));
    expect(kept.step).toBe('confirm');
    expect(hasChanges(kept, 'swap')).toBe(false);
    expect(canSubmit(kept, 'swap', 'optional', '')).toBe(false);
    expect(canSubmit(chooseBobtail({ ...kept, step: 'trailer' }), 'swap', 'optional', '')).toBe(true);
  });
});

describe('stepper reflects real progression', () => {
  it('marks each step complete exactly when decided', () => {
    const s0 = initialState();
    expect(stepperSteps(s0, 'start').map((x) => x.state)).toEqual(['current', 'upcoming', 'upcoming']);
    const s1 = selectVehicle(s0, unit({}));
    expect(stepperSteps(s1, 'start').map((x) => x.state)).toEqual(['complete', 'current', 'upcoming']);
    const s2 = chooseBobtail(s1);
    expect(stepperSteps(s2, 'start').map((x) => x.state)).toEqual(['complete', 'complete', 'current']);
  });
});

describe('ranking & filtering (per-step search, recent-first)', () => {
  const roster = [
    unit({ id: 'a', unit_number: '300' }),
    unit({ id: 'b', unit_number: '101', in_use_by: 'Sam' }),
    unit({ id: 'c', unit_number: '214', is_default: true }),
    unit({ id: 'd', unit_number: '102' }),
  ];

  it('last-used first, then your-truck, then free units, held last', () => {
    expect(rankEquipment(roster, 'd').map((o) => o.id)).toEqual(['d', 'c', 'a', 'b']);
  });

  it('without recency, your-truck leads and held units sink', () => {
    expect(rankEquipment(roster, null).map((o) => o.id)).toEqual(['c', 'd', 'a', 'b']);
  });

  it('filter matches unit number and never mutates input order', () => {
    expect(filterEquipment(roster, '10').map((o) => o.unit_number)).toEqual(['101', '102']);
    expect(filterEquipment(roster, '')).toHaveLength(4);
    expect(filterEquipment(roster, 'zzz')).toHaveLength(0);
  });
});
