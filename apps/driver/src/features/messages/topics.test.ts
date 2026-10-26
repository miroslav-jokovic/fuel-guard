import { describe, expect, it } from 'vitest';
import { driverMessagesTopic } from './topics';

/**
 * The driver app's Realtime topics must be exactly the names 0514's policy admits. A different
 * spelling joins nothing, and the app quietly falls back to its poll.
 */
const ME = '11111111-1111-4111-8111-111111111111';
const THREAD = '22222222-2222-4222-8222-222222222222';

describe('driverMessagesTopic', () => {
  it('names the signed-in person\'s own inbox', () => {
    expect(driverMessagesTopic(ME)).toBe(`driver:inbox:${ME}`);
  });

  it('names one conversation by its id, whoever is asking', () => {
    expect(driverMessagesTopic(ME, THREAD)).toBe(`driver:thread:${THREAD}`);
  });
});
