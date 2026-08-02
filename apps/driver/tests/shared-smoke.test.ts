import { describe, expect, it } from 'vitest';
import { USER_ROLES, derivePricePerGal, fillUpInputSchema } from '@fuelguard/shared';

// Proves the reuse contract: the RN app runs the exact same domain logic as web/api.
describe('@fuelguard/shared reuse', () => {
  it('math parity (derivePricePerGal)', () => {
    expect(derivePricePerGal(40, 120)).toBeCloseTo(3);
  });
  it('driver is a first-class role', () => {
    expect(USER_ROLES).toContain('driver');
  });
  it('shared Zod validates a fill-up', () => {
    const r = fillUpInputSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000000',
      vehicle_id: '00000000-0000-4000-8000-000000000001',
      fueled_at: new Date(0).toISOString(),
      gallons: 40,
    });
    expect(r.success).toBe(true);
  });
});
