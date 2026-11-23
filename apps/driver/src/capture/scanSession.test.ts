import { describe, expect, it } from 'vitest';
import { cancelScanSession, currentScanRequest, finishScanSession, startScanSession } from './scanSession';

const noop = (): void => undefined;

describe('scanSession', () => {
  it('hands the pages back in the order they were taken', async () => {
    const result = startScanSession({ maxPages: 10 }, noop);
    expect(currentScanRequest()).toEqual({ maxPages: 10 });
    finishScanSession(['file:///a.jpg', 'file:///b.jpg']);
    await expect(result).resolves.toEqual(['file:///a.jpg', 'file:///b.jpg']);
    expect(currentScanRequest()).toBeNull();
  });

  it('opens the screen when the session starts', () => {
    let opened = 0;
    void startScanSession({ maxPages: 1 }, () => opened++);
    expect(opened).toBe(1);
    cancelScanSession();
  });

  it('a close settles as null, so the caller treats it as a cancel', async () => {
    const result = startScanSession({ maxPages: 1 }, noop);
    cancelScanSession();
    await expect(result).resolves.toBeNull();
  });

  it('finishing with no pages is a close, not an empty scan', async () => {
    const result = startScanSession({ maxPages: 1 }, noop);
    finishScanSession([]);
    await expect(result).resolves.toBeNull();
  });

  it('a second session settles the first as closed instead of leaving it hanging', async () => {
    const first = startScanSession({ maxPages: 1 }, noop);
    const second = startScanSession({ maxPages: 3 }, noop);
    await expect(first).resolves.toBeNull();
    expect(currentScanRequest()).toEqual({ maxPages: 3 });
    finishScanSession(['file:///c.jpg']);
    await expect(second).resolves.toEqual(['file:///c.jpg']);
  });

  it('a late finish after a cancel changes nothing', async () => {
    const result = startScanSession({ maxPages: 1 }, noop);
    cancelScanSession();
    finishScanSession(['file:///late.jpg']);
    await expect(result).resolves.toBeNull();
  });
});
