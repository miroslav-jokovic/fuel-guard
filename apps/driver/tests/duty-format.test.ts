import { describe, expect, it } from 'vitest';
import { shiftDurationLabel } from '@/features/duty/dutyFormat';

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
