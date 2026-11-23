import { describe, expect, it } from 'vitest';
import { scanHeadline } from './scanHints';

const detection = { state: 'tracking', detectFps: 20, latencyMs: 10, confidence: 0.9 } as const;

describe('scanHeadline', () => {
  it('tells the driver what to fix while the gate waits', () => {
    expect(scanHeadline(null, { ...detection, gate: 'waiting', blocker: 'tooFar' })).toBe('Move closer');
    expect(scanHeadline(null, { ...detection, gate: 'waiting', blocker: 'tilted' })).toBe('Hold the phone flat above the page');
  });

  it('asks to hold still while the outline traces', () => {
    expect(scanHeadline(null, { ...detection, gate: 'tracing' })).toBe('Hold still');
  });

  it('a camera problem outranks any gate state', () => {
    expect(scanHeadline({ status: 'denied' }, { ...detection, gate: 'tracing' })).toBe('Camera access is off. Turn it on in Settings.');
  });

  it('a waiting gate with no blocker reads as no page', () => {
    expect(scanHeadline(null, { ...detection, gate: 'waiting' })).toBe('Point the camera at the page');
  });
});
