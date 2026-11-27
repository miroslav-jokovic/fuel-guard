import { describe, expect, it } from 'vitest';
import { LOAD_STATUS, driverLoadStatus } from '../src/features/loads/loadStatus';

// 0655 (DF-1): a McLeod load the office sent reaches the driver while McLeod still says
// pending_approval / approved. The driver never accepted it, so the app must not say "Accepted".
describe('driverLoadStatus', () => {
  it('reads a sent McLeod load before its first stop departs as Dispatched, not Accepted', () => {
    expect(LOAD_STATUS[driverLoadStatus('pending_approval')].label).toBe('Dispatched');
    expect(LOAD_STATUS[driverLoadStatus('approved')].label).toBe('Dispatched');
  });

  it('keeps Accepted for a load the driver accepted, and the rest unchanged', () => {
    expect(LOAD_STATUS[driverLoadStatus('accepted')].label).toBe('Accepted');
    expect(LOAD_STATUS[driverLoadStatus('offered')].label).toBe('Offered');
    expect(LOAD_STATUS[driverLoadStatus('in_transit')].label).toBe('In transit');
    expect(LOAD_STATUS[driverLoadStatus('delivered')].label).toBe('Delivered');
  });
});
