import { describe, expect, it } from 'vitest';
import type { EquipmentOption, MeEquipmentResponse } from '@silvicom/shared';
import { equipmentLine, startShortcut } from '@/features/duty/startShortcutModel';

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function option(n: number, over: Partial<EquipmentOption> = {}): EquipmentOption {
  return {
    id: id(n), unit_number: String(4470 + n), make: 'Freightliner', model: 'Cascadia',
    in_use_by: null, in_use_since: null, is_default: false, ...over,
  };
}

const roster: MeEquipmentResponse = {
  vehicles: [option(1), option(2, { in_use_by: 'someone-else' })],
  trailers: [option(11), option(12, { in_use_by: 'someone-else' })],
};

const YESTERDAY = { vehicleId: id(1), trailerId: id(11) };

describe('startShortcut', () => {
  it('offers the same rig when the truck and trailer are both free', () => {
    const s = startShortcut(YESTERDAY, roster, 'optional');
    expect(s?.vehicle.id).toBe(id(1));
    expect(s?.trailer?.id).toBe(id(11));
  });

  it('still offers the truck when the trailer is taken — bobtail is a real morning', () => {
    // "Same truck, no trailer yet" is common. What it must never do is substitute a DIFFERENT
    // trailer, which would have the driver walking to the wrong one.
    const s = startShortcut({ vehicleId: id(1), trailerId: id(12) }, roster, 'optional');
    expect(s?.vehicle.id).toBe(id(1));
    expect(s?.trailer).toBeNull();
  });

  it('still offers the truck when the trailer is gone from the roster entirely', () => {
    const s = startShortcut({ vehicleId: id(1), trailerId: id(99) }, roster, 'optional');
    expect(s?.trailer).toBeNull();
  });

  it('offers bobtail when yesterday was bobtail', () => {
    const s = startShortcut({ vehicleId: id(1), trailerId: null }, roster, 'optional');
    expect(s?.vehicle.id).toBe(id(1));
    expect(s?.trailer).toBeNull();
  });

  it('declines when someone else has the truck', () => {
    // `in_use_by` is the server's word and only the server can know a colleague took it at 04:00.
    expect(startShortcut({ vehicleId: id(2), trailerId: null }, roster, 'optional')).toBeNull();
  });

  it('declines when the truck is no longer on the roster', () => {
    expect(startShortcut({ vehicleId: id(98), trailerId: null }, roster, 'optional')).toBeNull();
  });

  it('declines with nothing remembered', () => {
    expect(startShortcut({ vehicleId: null, trailerId: null }, roster, 'optional')).toBeNull();
  });

  it('declines before the roster has loaded rather than guessing from memory alone', () => {
    expect(startShortcut(YESTERDAY, undefined, 'optional')).toBeNull();
  });

  it('declines outright when the org requires an odometer reading', () => {
    // There is nothing to prefill, and a one-tap button that opens a form is not a one-tap button.
    expect(startShortcut(YESTERDAY, roster, 'required')).toBeNull();
    expect(startShortcut(YESTERDAY, roster, 'optional')).not.toBeNull();
  });
});

describe('equipmentLine', () => {
  it('names the unit and what it is', () => {
    expect(equipmentLine(option(1))).toBe('Unit 4471 · Freightliner Cascadia');
  });

  it('drops the separator when the roster has no make or model', () => {
    expect(equipmentLine(option(1, { make: null, model: null }))).toBe('Unit 4471');
    expect(equipmentLine(option(1, { model: null }))).toBe('Unit 4471 · Freightliner');
  });
});
