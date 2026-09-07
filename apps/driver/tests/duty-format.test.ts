import { describe, expect, it } from 'vitest';
import { completedToday, shiftDurationLabel, stopsCompletedToday } from '@/features/duty/dutyFormat';

const at = (iso: string) => new Date(iso).getTime();

describe('shiftDurationLabel', () => {
  it('formats hours and zero-padded minutes', () => {
    expect(shiftDurationLabel('2026-07-28T06:00:00Z', at('2026-07-28T12:12:00Z'))).toBe('6h 12m');
    expect(shiftDurationLabel('2026-07-28T06:00:00Z', at('2026-07-28T07:05:00Z'))).toBe('1h 05m');
  });

  it('drops the hours segment under an hour', () => {
    expect(shiftDurationLabel('2026-07-28T06:00:00Z', at('2026-07-28T06:48:00Z'))).toBe('48m');
    expect(shiftDurationLabel('2026-07-28T06:00:00Z', at('2026-07-28T06:00:20Z'))).toBe('0m');
  });

  it('clamps a negative delta (clock skew) to 0m instead of a negative label', () => {
    expect(shiftDurationLabel('2026-07-28T06:00:00Z', at('2026-07-28T05:30:00Z'))).toBe('0m');
  });

  it('returns null for a missing or unparseable start', () => {
    expect(shiftDurationLabel(null)).toBeNull();
    expect(shiftDurationLabel('not a date')).toBeNull();
  });
});

describe('completedToday', () => {
  const now = new Date('2026-09-07T22:00:00');

  it('keeps only rows finished on the device\'s calendar day', () => {
    const rows = [
      { id: 'a', completed_at: new Date('2026-09-07T09:15:00').toISOString() },
      { id: 'b', completed_at: new Date('2026-09-06T23:50:00').toISOString() },
      { id: 'c', completed_at: null },
    ];
    expect(completedToday(rows, now).map((r) => r.id)).toEqual(['a']);
  });

  it('uses LOCAL time, so a late sign-off still sees its own day', () => {
    // A driver signing off at 22:00 Central on the 7th is already the 8th in UTC. Comparing in UTC
    // would show them an empty summary at exactly the moment they want to read it.
    const lateLocal = new Date('2026-09-07T21:30:00');
    expect(completedToday([{ completed_at: lateLocal.toISOString() }], now)).toHaveLength(1);
  });

  it('ignores an unparseable timestamp instead of counting it', () => {
    expect(completedToday([{ completed_at: 'not-a-date' }], now)).toEqual([]);
  });
});

describe('stopsCompletedToday', () => {
  const now = new Date('2026-09-07T22:00:00');
  const at = (h: number) => new Date(`2026-09-07T${String(h).padStart(2, '0')}:00:00`).toISOString();

  it('counts skipped stops as worked — the driver still went there and dealt with it', () => {
    const loads = [
      { stops: [
        { status: 'completed', completed_at: at(9) },
        { status: 'skipped', completed_at: at(11) },
        { status: 'pending', completed_at: null },
      ] },
      { stops: [{ status: 'completed', completed_at: at(14) }] },
    ];
    expect(stopsCompletedToday(loads, now)).toBe(3);
  });

  it('does not count yesterday stops on a load that finished today', () => {
    const loads = [{ stops: [
      { status: 'completed', completed_at: new Date('2026-09-06T20:00:00').toISOString() },
      { status: 'completed', completed_at: at(8) },
    ] }];
    expect(stopsCompletedToday(loads, now)).toBe(1);
  });
});
