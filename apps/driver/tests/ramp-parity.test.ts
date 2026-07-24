import { describe, expect, it } from 'vitest';
import { ramps } from '../src/theme/ramps';

// Guards the RN hex mirror against the web OKLCH source of truth (plan §11.5 exit criteria).
describe('design token ramp parity', () => {
  it('brand anchors match the web tokens', () => {
    expect(ramps.brand[600]).toBe('#4f46e5'); // --viz-brand / logo
    expect(ramps.brand[500]).toBe('#6366f1');
    expect(ramps.brand[700]).toBe('#4338ca');
  });
  it('neutral anchors match the web tokens', () => {
    expect(ramps.neutral[50]).toBe('#f9fafb');
    expect(ramps.neutral[900]).toBe('#111827');
  });
  it('status anchors present', () => {
    expect(ramps.danger[600]).toBe('#dc2626');
    expect(ramps.success[600]).toBe('#16a34a');
  });
});
